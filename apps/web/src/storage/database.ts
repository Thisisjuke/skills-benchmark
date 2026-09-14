import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { jobs, schema, type Job, type NewJob } from "./schema";

export type WebDatabaseOptions = {
  databasePath?: string;
  migrationsFolder?: string;
  now?: () => Date;
};

export class WebDatabase {
  readonly path: string;
  readonly connection;
  private readonly client: Database.Database;
  private readonly now: () => Date;

  constructor(projectPath: string, options: WebDatabaseOptions = {}) {
    this.path = options.databasePath ?? join(projectPath, ".skillbench", "skillbench-web.sqlite");
    this.now = options.now ?? (() => new Date());
    mkdirSync(dirname(this.path), { recursive: true });
    this.client = new Database(this.path);
    this.client.pragma("foreign_keys = ON");
    this.client.pragma("journal_mode = WAL");
    this.connection = drizzle({ client: this.client, schema });
    migrate(this.connection, {
      migrationsFolder: options.migrationsFolder ?? resolveMigrationsFolder(),
    });
    this.markInterruptedJobs();
  }

  close(): void {
    this.client.close();
  }

  insertJob(job: NewJob): void {
    this.connection.insert(jobs).values(job).run();
  }

  getJob(id: string): Job | undefined {
    return this.connection.select().from(jobs).where(eq(jobs.id, id)).get();
  }

  listJobs(limit = 50): Job[] {
    return this.connection
      .select()
      .from(jobs)
      .orderBy(sql`${jobs.createdAt} DESC`)
      .limit(limit)
      .all();
  }

  transitionJob(
    id: string,
    from: readonly Job["status"][],
    values: Partial<Pick<Job, "status" | "result" | "error" | "startedAt" | "finishedAt">>,
  ): boolean {
    return (
      this.connection
        .update(jobs)
        .set(values)
        .where(and(eq(jobs.id, id), inArray(jobs.status, [...from])))
        .run().changes === 1
    );
  }

  private markInterruptedJobs(): void {
    const finishedAt = this.now().toISOString();
    this.connection
      .update(jobs)
      .set({ status: "interrupted", finishedAt })
      .where(inArray(jobs.status, ["queued", "running"]))
      .run();
  }
}

function resolveMigrationsFolder(): string {
  const candidates = [
    fileURLToPath(new URL("../drizzle", import.meta.url)),
    fileURLToPath(new URL("../../drizzle", import.meta.url)),
  ];
  const folder = candidates.find(existsSync);
  if (folder === undefined) throw new Error("Packaged Drizzle migrations are missing");
  return folder;
}
