import { inspectSkill, type InspectResult } from "@skillbench/sdk/inspect";
import type { ResolveOptions } from "@skillbench/sdk/sources";

import type { ApplicationContext, OperationEvents, OutputRequest } from "./context";
import { resolveApplicationSource } from "./source";
import type { SkillbenchConfig } from "../config";
import type { WrittenBundle } from "../bundles";

export type InspectRequest = OutputRequest & {
  config: SkillbenchConfig;
  projectRoot: string;
  source: string;
  resolveOptions: ResolveOptions;
  events: OperationEvents;
};

export type InspectOperationResult = {
  result: InspectResult;
  bundle?: WrittenBundle;
};

export async function executeInspect(
  context: ApplicationContext,
  request: InspectRequest,
): Promise<InspectOperationResult> {
  const resolved = await request.events.progress("Resolving source", () =>
    resolveApplicationSource(
      context.sourceService(request.config, request.projectRoot),
      request.source,
      request.resolveOptions,
      context.now(),
    ),
  );
  const result = await inspectSkill({ resolve: async () => resolved }, request.source, {
    now: context.now(),
  });
  const bundle =
    request.output === undefined
      ? undefined
      : context.writeBundle({
          cwd: request.projectRoot,
          command: "inspect",
          output: request.output,
          result,
          sources: [{ role: "skill", skill: resolved }],
          force: request.force === true,
        });
  return { result, ...(bundle === undefined ? {} : { bundle }) };
}
