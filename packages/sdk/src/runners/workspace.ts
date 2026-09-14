import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { SkillbenchError } from "../errors";
import { silentLogger, type Logger } from "../logging";
import { hashBytes } from "../skills";
import type { RunArtifact, RunFixture, RunInput } from "./runner";

export const RUN_MANIFEST_RELATIVE_PATH = ".skillbench/run.json";

export type PreparedWorkspace = {
  workspacePath: string;
  skillDirectoryName: string;
  skillDirectory: string;
  skillPath: string;
  manifestPath: string;
};

export type WorkspaceManagerOptions = {
  skillRoot?: string;
};

type WorkspaceFile = {
  contentHash: string;
  sizeBytes: number;
};

export type WorkspaceState = ReadonlyMap<string, WorkspaceFile>;

export function resolveInside(root: string, relativePath: string, label: string): string {
  if (isAbsolute(relativePath)) {
    throw new SkillbenchError(`${label} must be relative: ${relativePath}`, {
      code: "WORKSPACE_PATH_UNSAFE",
    });
  }
  const target = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new SkillbenchError(`${label} escapes the workspace: ${relativePath}`, {
      code: "WORKSPACE_PATH_UNSAFE",
    });
  }
  return target;
}

export function skillDirectoryName(input: RunInput): string {
  const suffix = createHash("sha256")
    .update(`${input.snapshot.id}\0${input.snapshot.fingerprint}`)
    .digest("hex")
    .slice(0, 20);
  return `skillbench-${suffix}`;
}

export class WorkspaceManager {
  private readonly skillRoot: string;
  private readonly internalDirectories: ReadonlySet<string>;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly logger: Logger = silentLogger,
    options: WorkspaceManagerOptions = {},
  ) {
    this.skillRoot = normalizeSkillRoot(options.skillRoot ?? ".agents/skills");
    this.internalDirectories = new Set([
      ".agents",
      ".claude",
      ".skillbench",
      this.skillRoot.split("/", 1)[0]!,
    ]);
  }

  async prepare(input: RunInput): Promise<PreparedWorkspace> {
    this.logger.debug("workspace.prepare.start", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      snapshotId: input.snapshot.id,
      fixtureCount: input.fixtures.length,
    });
    await mkdir(dirname(resolve(input.workspacePath)), { recursive: true });
    try {
      await mkdir(input.workspacePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new SkillbenchError(`Run workspace already exists: ${input.workspacePath}`, {
          code: "WORKSPACE_COLLISION",
          cause: error,
        });
      }
      throw error;
    }

    try {
      const generatedName = skillDirectoryName(input);
      const skillDirectory = `${this.skillRoot}/${generatedName}`;
      const skillPath = resolveInside(input.workspacePath, skillDirectory, "skill destination");
      for (const file of input.snapshot.files) {
        const destination = resolveInside(skillPath, file.relativePath, "snapshot file path");
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content);
      }
      for (const fixture of input.fixtures) await this.copyFixture(input.workspacePath, fixture);

      const manifestPath = resolveInside(
        input.workspacePath,
        RUN_MANIFEST_RELATIVE_PATH,
        "run manifest",
      );
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            runId: input.runId,
            evalCaseId: input.evalCaseId,
            repetition: input.repetition,
            snapshotId: input.snapshot.id,
            snapshotFingerprint: input.snapshot.fingerprint,
            executionProfile: input.executionProfile,
            skillDirectory,
            fixtures: input.fixtures.map((fixture) => fixture.destinationPath),
            createdAt: this.now().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      const prepared = {
        workspacePath: input.workspacePath,
        skillDirectoryName: generatedName,
        skillDirectory,
        skillPath,
        manifestPath,
      };
      this.logger.debug("workspace.prepare.complete", {
        runId: input.runId,
        evalCaseId: input.evalCaseId,
        repetition: input.repetition,
        skillDirectory,
        snapshotFileCount: input.snapshot.files.length,
        fixtureCount: input.fixtures.length,
      });
      return prepared;
    } catch (error) {
      await rm(input.workspacePath, { recursive: true, force: true });
      this.logger.debug("workspace.prepare.failed", {
        runId: input.runId,
        evalCaseId: input.evalCaseId,
        repetition: input.repetition,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }

  async captureState(workspacePath: string): Promise<WorkspaceState> {
    const files = new Map<string, WorkspaceFile>();
    await this.captureTree(resolve(workspacePath), resolve(workspacePath), files);
    return files;
  }

  diffArtifacts(before: WorkspaceState, after: WorkspaceState): RunArtifact[] {
    return [...after.entries()]
      .filter(([relativePath, file]) => {
        const previous = before.get(relativePath);
        return previous === undefined || previous.contentHash !== file.contentHash;
      })
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([relativePath, file]) => ({ relativePath, ...file }));
  }

  async writeOutput(
    workspacePath: string,
    relativePath: string,
    content: Uint8Array,
  ): Promise<void> {
    const destination = resolveInside(workspacePath, relativePath, "mock output path");
    const fromRoot = relative(workspacePath, destination).split(sep);
    if (fromRoot[0] !== undefined && this.internalDirectories.has(fromRoot[0])) {
      throw new SkillbenchError(`Mock output cannot overwrite run internals: ${relativePath}`, {
        code: "WORKSPACE_PATH_UNSAFE",
      });
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }

  private async copyFixture(workspacePath: string, fixture: RunFixture): Promise<void> {
    const stats = await lstat(fixture.sourcePath);
    if (stats.isSymbolicLink()) {
      throw new SkillbenchError(`Fixture cannot be a symbolic link: ${fixture.sourcePath}`, {
        code: "EVAL_FIXTURE_UNSAFE",
      });
    }
    const destination = resolveInside(
      workspacePath,
      fixture.destinationPath,
      "fixture destination",
    );
    if (stats.isDirectory() && fixture.destinationPath === ".") {
      await mkdir(destination, { recursive: true });
      for (const entry of await readdir(fixture.sourcePath)) {
        await this.copyTree(resolve(fixture.sourcePath, entry), resolve(destination, entry));
      }
      return;
    }
    if (stats.isFile() && fixture.destinationPath === ".") {
      await this.copyTree(fixture.sourcePath, resolve(destination, basename(fixture.sourcePath)));
      return;
    }
    await this.copyTree(fixture.sourcePath, destination);
  }

  private async copyTree(source: string, destination: string): Promise<void> {
    const stats = await lstat(source);
    if (stats.isSymbolicLink()) {
      throw new SkillbenchError(`Fixture tree contains a symbolic link: ${source}`, {
        code: "EVAL_FIXTURE_UNSAFE",
      });
    }
    if (stats.isDirectory()) {
      await mkdir(destination, { recursive: true });
      const entries = await readdir(source);
      entries.sort((left, right) => left.localeCompare(right, "en"));
      for (const entry of entries)
        await this.copyTree(resolve(source, entry), resolve(destination, entry));
      return;
    }
    if (stats.isFile()) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(source));
    }
  }

  private async captureTree(
    root: string,
    current: string,
    files: Map<string, WorkspaceFile>,
  ): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      const firstSegment = relativePath.split("/", 1)[0];
      if (
        entry.isDirectory() &&
        firstSegment !== undefined &&
        this.internalDirectories.has(firstSegment)
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        await this.captureTree(root, absolutePath, files);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(absolutePath);
      files.set(relativePath, { contentHash: hashBytes(content), sizeBytes: content.byteLength });
    }
  }
}

function normalizeSkillRoot(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new SkillbenchError(`Skill root must be a safe relative directory: ${value}`, {
      code: "WORKSPACE_PATH_UNSAFE",
    });
  }
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
