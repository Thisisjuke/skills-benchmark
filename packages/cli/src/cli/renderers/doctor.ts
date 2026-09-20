import type { DoctorResult } from "../../application/doctor";

export function renderDoctor(result: DoctorResult): string {
  const assetStatus = result.assets.valid ? "valid" : `invalid — ${result.assets.remediation}`;
  const runnerStatus = result.runner.configured
    ? `${result.runner.runner} (${
        result.runner.available
          ? result.runner.supported
            ? (result.runner.version ?? "available")
            : `${result.runner.version ?? "unknown version"} — unsupported — ${result.runner.remediation}`
          : `unavailable — ${result.runner.remediation}`
      })`
    : `not configured — ${result.runner.remediation}`;
  return `${[
    "Skillbench doctor",
    `Node: ${result.node.version} (${result.node.supported ? "supported" : `requires >= ${result.node.minimum}`})`,
    `Project: ${result.project.initialized ? result.project.configFile : "not initialized"}`,
    `Project root: ${result.project.root}`,
    `State: ${result.project.stateDirectory}`,
    `Assets: ${assetStatus}`,
    `Runner: ${runnerStatus}`,
    `Promptfoo: ${result.promptfoo.version} (embedded)`,
    `GitHub auth: ${result.github.authenticated ? result.github.tokenEnvironment : "not configured"}`,
  ].join("\n")}\n`;
}
