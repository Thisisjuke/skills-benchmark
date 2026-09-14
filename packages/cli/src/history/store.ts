import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import * as z from "zod";

import {
  runnerEffortSchema,
  runnerTypeSchema,
  type RunnerEffort,
} from "../composition/runner-registry";
import { silentLogger, type Logger } from "@skillbench/sdk/logging";

export const CLI_HISTORY_VERSION = 1 as const;
export const CLI_HISTORY_LIMIT = 10;

const entrySchema = z.strictObject({
  id: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  cwd: z.string().min(1),
  sourceA: z.string().min(1),
  sourceB: z.string().min(1),
  skillPathA: z.string().min(1).optional(),
  skillPathB: z.string().min(1).optional(),
  evals: z.string().min(1),
  output: z.string().min(1).optional(),
  partition: z.enum(["development", "holdout"]),
  repeat: z.number().int().min(1).max(100),
  runner: runnerTypeSchema,
  model: z.string().min(1).optional(),
  reasoningEffort: runnerEffortSchema.optional(),
});

const documentSchema = z.strictObject({
  schemaVersion: z.literal(CLI_HISTORY_VERSION),
  entries: z.array(entrySchema).max(CLI_HISTORY_LIMIT),
});

export type CliHistoryEntry = z.infer<typeof entrySchema>;
export type NewCliHistoryEntry = Omit<CliHistoryEntry, "id" | "createdAt"> & {
  reasoningEffort?: RunnerEffort;
};

export class CliHistoryStore {
  readonly path: string;

  constructor(
    cwd: string,
    private readonly logger: Logger = silentLogger,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {
    this.path = join(cwd, ".skillbench", "cli-history.json");
  }

  list(): CliHistoryEntry[] {
    if (!existsSync(this.path)) return [];
    try {
      return documentSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))).entries;
    } catch (error) {
      this.logger.debug("cli.history.invalid", { path: this.path, error });
      return [];
    }
  }

  get(id: string): CliHistoryEntry | undefined {
    return this.list().find((entry) => entry.id === id);
  }

  record(input: NewCliHistoryEntry): CliHistoryEntry {
    const entries = this.list();
    const key = normalizedKey(input);
    const existing = entries.find((entry) => normalizedKey(entry) === key);
    const entry = entrySchema.parse({
      ...input,
      id: existing?.id ?? this.id(),
      createdAt: this.now().toISOString(),
    });
    const next = [entry, ...entries.filter((candidate) => normalizedKey(candidate) !== key)].slice(
      0,
      CLI_HISTORY_LIMIT,
    );
    this.write(next);
    return entry;
  }

  private write(entries: readonly CliHistoryEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify({ schemaVersion: CLI_HISTORY_VERSION, entries }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporary, this.path);
  }
}

function normalizedKey(entry: NewCliHistoryEntry | CliHistoryEntry): string {
  return JSON.stringify({
    cwd: entry.cwd,
    sourceA: entry.sourceA,
    sourceB: entry.sourceB,
    skillPathA: entry.skillPathA,
    skillPathB: entry.skillPathB,
    evals: entry.evals,
    output: entry.output,
    partition: entry.partition,
    repeat: entry.repeat,
    runner: entry.runner,
    model: entry.model,
    reasoningEffort: entry.reasoningEffort,
  });
}
