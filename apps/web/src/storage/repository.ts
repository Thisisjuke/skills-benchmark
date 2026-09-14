import { and, eq, max, sql } from "drizzle-orm";

import type { SkillbenchBundleManifest } from "@thisisjuke/skillbench/contracts/bundles";
import type {
  SkillbenchEvent,
  SkillbenchResultEnvelope,
} from "@thisisjuke/skillbench/contracts";
import type { WebJobRequest } from "../jobs/request";
import type { WebDatabase } from "./database";
import {
  artifacts,
  jobEvents,
  jobs,
  reports,
  runs,
  sourceSnapshots,
  sources,
  type Job,
} from "./schema";

export class WebRepository {
  constructor(private readonly database: WebDatabase) {}

  createJob(id: string, request: WebJobRequest, createdAt: string): Job {
    this.database.insertJob({
      id,
      command: request.command,
      status: "queued",
      request,
      createdAt,
    });
    return this.requireJob(id);
  }

  requireJob(id: string): Job {
    const job = this.database.getJob(id);
    if (job === undefined) throw new Error(`Job not found: ${id}`);
    return job;
  }

  listJobs(limit?: number): Job[] {
    return this.database.listJobs(limit);
  }

  startJob(id: string, startedAt: string): boolean {
    return this.database.transitionJob(id, ["queued"], { status: "running", startedAt });
  }

  failJob(id: string, error: Job["error"], finishedAt: string): void {
    this.database.transitionJob(id, ["queued", "running"], {
      status: "failed",
      error,
      finishedAt,
    });
  }

  cancelJob(id: string, finishedAt: string): boolean {
    return this.database.transitionJob(id, ["queued", "running"], {
      status: "cancelled",
      finishedAt,
    });
  }

  appendEvent(jobId: string, event: SkillbenchEvent): number {
    const current = this.database.connection
      .select({ value: max(jobEvents.sequence) })
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .get()?.value;
    const sequence = (current ?? 0) + 1;
    this.database.connection
      .insert(jobEvents)
      .values({ jobId, sequence, event: event.event, payload: event, createdAt: event.timestamp })
      .run();
    return sequence;
  }

  listEvents(jobId: string, after = 0): (typeof jobEvents.$inferSelect)[] {
    return this.database.connection
      .select()
      .from(jobEvents)
      .where(sql`${jobEvents.jobId} = ${jobId} AND ${jobEvents.sequence} > ${after}`)
      .orderBy(jobEvents.sequence)
      .all();
  }

  getRunDetails(jobId: string) {
    const run = this.database.connection.select().from(runs).where(eq(runs.jobId, jobId)).get();
    if (run === undefined) return null;
    return {
      ...run,
      sources: this.database.connection
        .select()
        .from(sourceSnapshots)
        .where(eq(sourceSnapshots.runId, run.id))
        .all(),
      reports: this.database.connection
        .select()
        .from(reports)
        .where(eq(reports.runId, run.id))
        .all(),
      artifacts: this.database.connection
        .select()
        .from(artifacts)
        .where(eq(artifacts.runId, run.id))
        .all(),
    };
  }

  getRunFile(runId: string, kind: "report" | "artifact", id: string) {
    const run = this.database.connection.select().from(runs).where(eq(runs.id, runId)).get();
    if (run === undefined) return undefined;
    if (kind === "report") {
      const file = this.database.connection
        .select()
        .from(reports)
        .where(and(eq(reports.runId, runId), eq(reports.id, id)))
        .get();
      return file === undefined ? undefined : { run, file, mediaType: file.mediaType };
    }
    const file = this.database.connection
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.id, id)))
      .get();
    return file === undefined
      ? undefined
      : { run, file, mediaType: "application/octet-stream" as const };
  }

  completeJob(
    jobId: string,
    bundlePath: string,
    manifest: SkillbenchBundleManifest,
    result: SkillbenchResultEnvelope,
    finishedAt: string,
  ): void {
    this.database.connection.transaction((transaction) => {
      const changed = transaction
        .update(jobs)
        .set({ status: "completed", result, finishedAt })
        .where(sql`${jobs.id} = ${jobId} AND ${jobs.status} = 'running'`)
        .run().changes;
      if (changed !== 1) throw new Error(`Job cannot complete from its current state: ${jobId}`);
      transaction
        .insert(runs)
        .values({
          id: jobId,
          jobId,
          command: manifest.command,
          result,
          bundlePath,
          createdAt: manifest.createdAt,
        })
        .run();
      if (manifest.sources.length > 0) {
        transaction
          .insert(sourceSnapshots)
          .values(
            manifest.sources.map((source) => ({
              id: `${jobId}:${source.role}`,
              runId: jobId,
              role: source.role,
              origin: source.origin,
              originalInput: source.originalInput,
              rootPath: source.rootPath,
              fingerprint: source.fingerprint,
              manifest: source,
            })),
          )
          .run();
      }
      if (manifest.reports.length > 0) {
        transaction
          .insert(reports)
          .values(
            manifest.reports.map((report) => ({
              id: `${jobId}:${report.id}`,
              runId: jobId,
              path: report.path,
              mediaType: report.mediaType,
              contentHash: report.contentHash,
              sizeBytes: report.sizeBytes,
            })),
          )
          .run();
      }
      if (manifest.artifacts.length > 0) {
        transaction
          .insert(artifacts)
          .values(
            manifest.artifacts.map((artifact) => ({
              id: `${jobId}:${artifact.path}`,
              runId: jobId,
              kind: artifact.kind,
              path: artifact.path,
              contentHash: artifact.contentHash,
              sizeBytes: artifact.sizeBytes,
            })),
          )
          .run();
      }
    });
  }

  listSources() {
    return this.database.connection
      .select()
      .from(sources)
      .orderBy(sources.updatedAt)
      .all()
      .reverse();
  }

  saveSource(input: {
    id: string;
    label: string;
    kind: "local" | "github";
    source: string;
    skillPath?: string;
    now: string;
  }) {
    this.database.connection
      .insert(sources)
      .values({
        id: input.id,
        label: input.label,
        kind: input.kind,
        input: input.source,
        skillPath: input.skillPath,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run();
    return this.database.connection.select().from(sources).where(eq(sources.id, input.id)).get();
  }

  deleteSource(id: string): boolean {
    return this.database.connection.delete(sources).where(eq(sources.id, id)).run().changes === 1;
  }
}
