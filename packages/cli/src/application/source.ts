import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ResolvedSkill } from "@skillbench/sdk/skills";
import type { ResolveOptions, SkillSourceService } from "@skillbench/sdk/sources";

export function resolveApplicationSource(
  service: SkillSourceService,
  input: string,
  options: ResolveOptions,
  now: Date,
): Promise<ResolvedSkill> {
  if (options.offline === true && service.capabilities(input).locality === "remote") {
    throw new SkillbenchError(`Offline mode cannot resolve a remote source: ${input}`, {
      code: "SOURCE_OFFLINE_REMOTE_FORBIDDEN",
    });
  }
  return service.resolve(input, { ...options, now });
}
