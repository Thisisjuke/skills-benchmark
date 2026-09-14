import assert from "node:assert/strict";

import type { SourceProviderId } from "@skillbench/sdk/skills";
import type { ResolveOptions, SkillSourceResolver } from "@skillbench/sdk/sources";

export type SourceResolverContract = {
  resolver: SkillSourceResolver;
  supportedInput: string;
  unsupportedInput: string;
  options?: ResolveOptions;
  expectedOrigin: SourceProviderId;
};

export async function verifySourceResolverContract(
  contract: SourceResolverContract,
): Promise<void> {
  assert.equal(contract.resolver.supports(contract.supportedInput), true);
  assert.equal(contract.resolver.supports(contract.unsupportedInput), false);
  assert.equal(contract.resolver.capabilities.provider, contract.expectedOrigin);
  const resolved = await contract.resolver.resolve(contract.supportedInput, contract.options);
  assert.equal(resolved.snapshot.origin.type, contract.expectedOrigin);
  assert.ok(resolved.snapshot.files.some((file) => file.relativePath === "SKILL.md"));
  assert.match(resolved.snapshot.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(resolved))), JSON.stringify(resolved));
}
