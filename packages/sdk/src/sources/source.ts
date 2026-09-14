import * as z from "zod";

import { sourceProviderIdSchema, type ResolvedSkill, type SourceProviderId } from "../skills";

export const skillSourceCapabilitiesSchema = z.strictObject({
  provider: sourceProviderIdSchema,
  locality: z.enum(["local", "remote"]),
});

export type SkillSourceCapabilities = z.infer<typeof skillSourceCapabilitiesSchema>;

export type NamedSource = {
  id: string;
  kind: SourceProviderId;
  alias: string;
  originalInput: string;
  createdAt: string;
  latestSnapshotId?: string;
};

export type ResolveOptions = {
  now?: Date;
  offline?: boolean;
  skillPath?: string;
  selectSkill?: (paths: readonly string[]) => Promise<string>;
};

export interface SkillSourceResolver {
  readonly capabilities: SkillSourceCapabilities;
  supports(input: string): boolean;
  resolve(input: string, options?: ResolveOptions): Promise<ResolvedSkill>;
}

export interface ResolvedSkillStore {
  save(resolvedSkill: ResolvedSkill): ResolvedSkill;
}

export interface NamedSourceStore {
  findByAlias(alias: string): NamedSource | undefined;
  listNamed(): NamedSource[];
  setAlias(snapshotId: string, alias: string): NamedSource;
}
