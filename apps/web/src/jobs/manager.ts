import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  skillbenchBundleManifestSchema,
  type SkillbenchBundleManifest,
} from "@thisisjuke/skillbench/contracts/bundles";
import {
  skillbenchResultEnvelopeSchema,
  type SkillbenchEvent,
  type SkillbenchResultEnvelope,
} from "@thisisjuke/skillbench/contracts";
import { resolveSkillbenchCliPath } from "@thisisjuke/skillbench/cli-path";
import { execa } from "execa";
import PQueue from "p-queue";

import { WebRepository, type Job } from "../storage";
import { parseSkillbenchEvent } from "./jsonl";
import { buildCliArguments, type WebJobRequest } from "./request";

const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type JobManagerOptions = {
  projectPath: string;
  repository: WebRepository;
  cliPath?: string;
  now?: () => Date;
  id?: () => string;
};

export class JobManager {
  private readonly projectPath: string;
  private readonly repository: WebRepository;
  private readonly cliPath: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly controllers = new Map<string, AbortController>();
  private readonly subscribers = new Map<string, Set<(event: SkillbenchEvent) => void>>();

  constructor(options: JobManagerOptions) {
    this.projectPath = resolve(options.projectPath);
    this.repository = options.repository;
    this.cliPath = options.cliPath ?? resolveSkillbenchCliPath();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  create(request: WebJobRequest): Job {
    const id = this.id();
    const controller = new AbortController();
    const job = this.repository.createJob(id, request, this.now().toISOString());
    this.controllers.set(id, controller);
    void this.queue
      .add(() => this.execute(id, request, controller.signal))
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.repository.failJob(id, protocolError(error), this.now().toISOString());
        }
      });
    return job;
  }

  cancel(id: string): boolean {
    const job = this.repository.requireJob(id);
    if (!["queued", "running"].includes(job.status)) return false;
    const changed = this.repository.cancelJob(id, this.now().toISOString());
    this.controllers.get(id)?.abort(new Error("Cancelled by user"));
    return changed;
  }

  subscribe(jobId: string, listener: (event: SkillbenchEvent) => void): () => void {
    const listeners = this.subscribers.get(jobId) ?? new Set();
    listeners.add(listener);
    this.subscribers.set(jobId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.subscribers.delete(jobId);
    };
  }

  async shutdown(): Promise<void> {
    this.queue.clear();
    for (const [id, controller] of this.controllers) {
      this.repository.cancelJob(id, this.now().toISOString());
      controller.abort(new Error("Web server shutting down"));
    }
    await this.queue.onIdle();
  }

  private async execute(id: string, request: WebJobRequest, signal: AbortSignal): Promise<void> {
    if (!this.repository.startJob(id, this.now().toISOString())) return;
    const webRoot = join(this.projectPath, ".skillbench", "web");
    const temporaryRoot = join(webRoot, "tmp");
    const bundlesRoot = join(webRoot, "bundles");
    await mkdir(temporaryRoot, { recursive: true });
    await mkdir(bundlesRoot, { recursive: true });
    const workspace = await mkdtemp(join(temporaryRoot, `${id}-`));
    const output = join(workspace, "bundle");
    let stderr = "";
    try {
      signal.throwIfAborted();
      const child = execa(process.execPath, [this.cliPath, ...buildCliArguments(request, output)], {
        cwd: this.projectPath,
        cancelSignal: signal,
        reject: false,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (Buffer.byteLength(stderr) >= MAX_STDERR_BYTES) return;
        stderr = `${stderr}${String(chunk)}`.slice(0, MAX_STDERR_BYTES);
      });
      let completed: (SkillbenchEvent & { event: "completed" }) | undefined;
      for await (const line of child) {
        if (line.trim() === "") continue;
        const event = parseSkillbenchEvent(line);
        if (event.command !== request.command) {
          throw new Error(`CLI event command ${event.command} does not match ${request.command}`);
        }
        this.repository.appendEvent(id, event);
        for (const listener of this.subscribers.get(id) ?? []) listener(event);
        if (event.event === "completed") completed = event;
      }
      const result = await child;
      signal.throwIfAborted();
      if (result.exitCode !== 0) {
        throw new Error(`CLI exited with ${result.exitCode}: ${stderr.trim() || "no diagnostic"}`);
      }
      if (completed === undefined) throw new Error("CLI exited without a completed JSONL event");

      const bundle = readAndValidateBundle(output, request.command);
      const finalBundle = join(bundlesRoot, id);
      renameSync(output, finalBundle);
      try {
        this.repository.completeJob(
          id,
          finalBundle,
          bundle.manifest,
          bundle.result,
          this.now().toISOString(),
        );
      } catch (error) {
        rmSync(finalBundle, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if (!signal.aborted) {
        this.repository.failJob(id, protocolError(error), this.now().toISOString());
      }
    } finally {
      this.controllers.delete(id);
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

function readAndValidateBundle(
  directory: string,
  expectedCommand: WebJobRequest["command"],
): { manifest: SkillbenchBundleManifest; result: SkillbenchResultEnvelope } {
  const manifest = skillbenchBundleManifestSchema.parse(readJson(join(directory, "manifest.json")));
  const result = skillbenchResultEnvelopeSchema.parse(readJson(join(directory, "result.json")));
  if (manifest.command !== expectedCommand || result.command !== expectedCommand) {
    throw new Error(`Bundle command does not match requested command ${expectedCommand}`);
  }
  const references = [
    manifest.result,
    ...manifest.sources.flatMap((source) => source.files),
    ...manifest.reports,
    ...manifest.artifacts,
    ...manifest.instructions,
  ];
  for (const reference of references) validateFile(directory, reference);
  return { manifest, result };
}

function readJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_DOCUMENT_BYTES) throw new Error(`Bundle document exceeds size limit: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateFile(
  root: string,
  reference: { path: string; contentHash: string; sizeBytes: number },
): void {
  const path = resolve(root, reference.path);
  if (path !== root && !path.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error(`Bundle path escapes its root: ${reference.path}`);
  }
  const stats = statSync(path);
  if (!stats.isFile() || stats.size !== reference.sizeBytes) {
    throw new Error(`Bundle file size mismatch: ${reference.path}`);
  }
  const hash = createHash("sha256");
  const content = readFileSync(path);
  hash.update(content);
  if (hash.digest("hex") !== reference.contentHash) {
    throw new Error(`Bundle file hash mismatch: ${reference.path}`);
  }
}

function protocolError(error: unknown): { code: string; message: string; exitCode: number } {
  return {
    code: error instanceof Error ? error.name : "WEB_JOB_FAILED",
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  };
}
