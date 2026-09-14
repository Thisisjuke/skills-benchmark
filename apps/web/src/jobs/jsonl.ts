import { skillbenchEventSchema, type SkillbenchEvent } from "@thisisjuke/skillbench/contracts";

const MAX_LINE_BYTES = 16 * 1024 * 1024;

export function parseSkillbenchEvent(line: string): SkillbenchEvent {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    throw new Error(`CLI JSONL line exceeds ${MAX_LINE_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `CLI emitted invalid JSONL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return skillbenchEventSchema.parse(value);
}
