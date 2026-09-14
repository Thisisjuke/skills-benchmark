import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const drizzleRoot = resolve(import.meta.dirname, "..", "drizzle");
const journal = JSON.parse(readFileSync(resolve(drizzleRoot, "meta", "_journal.json"), "utf8"));
if (
  journal.dialect !== "sqlite" ||
  !Array.isArray(journal.entries) ||
  journal.entries.length === 0
) {
  throw new Error("The Drizzle journal must contain at least one SQLite migration");
}

const tags = new Set();
for (const [position, entry] of journal.entries.entries()) {
  if (entry.idx !== position)
    throw new Error(`Migration ${entry.tag} has unexpected index ${entry.idx}`);
  if (typeof entry.tag !== "string" || tags.has(entry.tag)) {
    throw new Error(`Migration tag is missing or duplicated: ${String(entry.tag)}`);
  }
  tags.add(entry.tag);
  const sql = readFileSync(resolve(drizzleRoot, `${entry.tag}.sql`), "utf8").trim();
  if (sql === "") throw new Error(`Migration ${entry.tag}.sql is empty`);
}

const sqlTags = readdirSync(drizzleRoot)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => name.slice(0, -4));
for (const tag of sqlTags) {
  if (!tags.has(tag)) throw new Error(`Migration ${tag}.sql is not registered in the journal`);
}
if (sqlTags.length !== tags.size) throw new Error("The Drizzle migration journal is incomplete");

process.stdout.write(`Validated ${tags.size} SQLite migration${tags.size === 1 ? "" : "s"}.\n`);
