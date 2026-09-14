import { resolve } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";

import {
  INITIALIZED_PROJECT_FILES,
  initializeProject,
  initializedProjectConflicts,
  type InitResult,
} from "../init";
import type { ExecutionCommandContext } from "./command-context";
import type { PromptSession } from "./interactive";
import type { GlobalOptions } from "./options";

export async function initializeProjectFlow(input: {
  context: ExecutionCommandContext;
  session: PromptSession;
  global: GlobalOptions;
  force: boolean;
}): Promise<InitResult> {
  const projectRoot = resolve(input.context.cwd());
  const conflicts = initializedProjectConflicts(projectRoot);
  if (conflicts.length > 0 && !input.force) {
    throw new SkillbenchError(
      `Initialization would overwrite existing files: ${conflicts.join(", ")}. ` +
        "Use --force only after reviewing those files.",
      { code: "CLI_INIT_EXISTS" },
    );
  }
  const profile = await input.session.initializationRunnerChoice(input.global);
  await input.session.confirmInitialization(
    projectRoot,
    INITIALIZED_PROJECT_FILES.map(
      (file) => `${file.path} — ${file.description}`,
    ),
  );
  return initializeProject(projectRoot, { force: input.force, profile });
}
