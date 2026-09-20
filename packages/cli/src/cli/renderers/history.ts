import type { CliHistoryEntry } from "../../history";

export function renderHistory(entries: readonly CliHistoryEntry[]): string {
  return entries.length === 0
    ? "No comparisons in CLI history.\n"
    : `${entries
        .map(
          (entry) =>
            `${entry.id}\t${entry.sourceA} vs ${entry.sourceB}\t${historyHint(entry)}`,
        )
        .join("\n")}\n`;
}

export function historyHint(entry: CliHistoryEntry): string {
  const profile = [entry.runner, entry.model, entry.reasoningEffort, entry.variant].filter(
    (value): value is string => value !== undefined,
  );
  const timestamp = new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ");
  return `${entry.evals} · ${profile.join(" · ")} · ${entry.repeat}× · ${timestamp}Z`;
}
