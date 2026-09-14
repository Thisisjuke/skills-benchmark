import type { SourceProviderId } from "./provider";

export type SkillFile = {
  relativePath: string;
  content: Uint8Array;
  contentHash: string;
  sizeBytes: number;
};

export type SkillOrigin = {
  type: SourceProviderId;
  originalInput: string;
};

export type SkillRepository = {
  owner: string;
  name: string;
  requestedRef: string;
  resolvedCommit: string;
};

export type SkillSnapshot = {
  id: string;
  origin: SkillOrigin;
  repository?: SkillRepository;
  rootPath: string;
  files: SkillFile[];
  fingerprint: string;
  fingerprintAlgorithm: string;
  fetchedAt: string;
};

export type ParsedSkill = {
  name: string;
  description: string;
  license?: string;
  metadata: Record<string, unknown>;
  markdown: string;
  relativeReferences: string[];
};

export type ResolvedSkill = {
  snapshot: SkillSnapshot;
  skill: ParsedSkill;
};
