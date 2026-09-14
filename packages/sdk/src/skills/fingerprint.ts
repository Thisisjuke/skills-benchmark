import { createHash } from "node:crypto";

import type { SkillFile } from "./types";

export const FINGERPRINT_ALGORITHM = "sha256-tree-v1";

export function hashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function fingerprintFiles(files: readonly SkillFile[]): string {
  const entries = [...files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"))
    .map((file) => [file.relativePath, file.contentHash, file.sizeBytes] as const);

  return createHash("sha256")
    .update(`${FINGERPRINT_ALGORITHM}\0`)
    .update(JSON.stringify(entries))
    .digest("hex");
}
