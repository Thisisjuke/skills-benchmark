import { sql } from "drizzle-orm";
import {
  SKILLBENCH_OPERATIONS,
  type SourceProviderId,
} from "@thisisjuke/skillbench/contracts";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["local", "github"] }).notNull(),
    input: text("input").notNull(),
    skillPath: text("skill_path"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("sources_kind_check", sql`${table.kind} IN ('local', 'github')`),
    unique("sources_input_skill_path_unique").on(table.input, table.skillPath),
    index("sources_updated_at_index").on(table.updatedAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    command: text("command", { enum: SKILLBENCH_OPERATIONS }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled", "interrupted"],
    }).notNull(),
    request: json<Record<string, unknown>>("request_json").notNull(),
    result: json<unknown>("result_json"),
    error: json<{ code: string; message: string; exitCode: number }>("error_json"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    check("jobs_command_check", sql`${table.command} IN ('inspect', 'eval', 'compare', 'merge')`),
    check(
      "jobs_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    index("jobs_created_at_index").on(table.createdAt),
    index("jobs_status_index").on(table.status),
  ],
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    event: text("event").notNull(),
    payload: json<unknown>("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sequence] }),
    index("job_events_job_sequence_index").on(table.jobId, table.sequence),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: "cascade" }),
    command: text("command", { enum: SKILLBENCH_OPERATIONS }).notNull(),
    result: json<unknown>("result_json").notNull(),
    bundlePath: text("bundle_path").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("runs_created_at_index").on(table.createdAt)],
);

export const sourceSnapshots = sqliteTable(
  "source_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["skill", "A", "B"] }).notNull(),
    origin: text("origin").$type<SourceProviderId>().notNull(),
    originalInput: text("original_input").notNull(),
    rootPath: text("root_path").notNull(),
    fingerprint: text("fingerprint").notNull(),
    manifest: json<Record<string, unknown>>("manifest_json").notNull(),
  },
  (table) => [
    unique("source_snapshots_run_role_unique").on(table.runId, table.role),
    index("source_snapshots_fingerprint_index").on(table.fingerprint),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    mediaType: text("media_type").notNull(),
    contentHash: text("content_hash").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (table) => [unique("reports_run_path_unique").on(table.runId, table.path)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["file", "skill"] }).notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (table) => [unique("artifacts_run_path_unique").on(table.runId, table.path)],
);

export const schema = { artifacts, jobEvents, jobs, reports, runs, sourceSnapshots, sources };

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
