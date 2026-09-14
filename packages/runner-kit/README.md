# `@skillbench/runner-kit`

`runner-kit` shares process plumbing used by several runner adapters. It is a private
monorepo package: its code is bundled into public adapters and it is not published as a
user-facing API.

## Workspace contract

- **Status:** private production utility, bundled through runner adapters.
- **Owns:** bounded process execution, environment selection, output limits, shared trace and
  version mechanics, and permission-to-sandbox mapping.
- **Does not own:** provider argv, protocols, models, business use cases, terminal UX, or storage.
- **Internal dependency:** SDK runner contracts.
- **Direct dependents:** Codex and Claude runners.
- **Extension point:** add mechanics only after at least two runners require identical semantics.

## What the package provides

| Export | Role |
| --- | --- |
| `BoundedProcessExecutor` | starts an argv without a shell, with timeout, cancellation, and bounded output |
| `selectEnvironment` | builds an environment from an allowlist |
| `appendBounded` | appends diagnostics without exceeding the output limit |
| `sandboxFromPermissions` | resolves shared SDK permissions |
| `createRunnerTrace` | validates a versioned provider trace |
| `CachedVersionProbe` | deduplicates executable version detection |

```ts
import {
  BoundedProcessExecutor,
  selectEnvironment,
} from "@skillbench/runner-kit";

const executor = new BoundedProcessExecutor({
  executable: "my-agent",
  environment: selectEnvironment(process.env, ["HOME", "PATH", "MY_AGENT_TOKEN"]),
  maxOutputBytes: 1024 * 1024,
});

const result = await executor.execute(
  ["run", "--json", "<prompt>"],
  workspacePath,
  180_000,
  signal,
);
```

The token name above is an example: each adapter owns its actual allowlist and must
redact its secrets through the shared logger.

## Boundary

This package knows Execa and the SDK runner contracts. It knows nothing about:

- arguments or output formats for Codex, Claude, or another provider;
- supported models or effort levels;
- evaluators, comparators, or mergers;
- terminal interfaces or persistence.

Runners remain responsible for their protocol, sandbox, version validation, and error
translation.

## Modify or duplicate

Add a function here only when at least two runners have exactly the same semantics.
Syntactic similarity between two argv arrays is not a shared contract. Prefer
composable functions over a base class that would impose a provider lifecycle.

Do not duplicate `runner-kit` for each agent. Create a sibling adapter package that
uses it. If a future runtime family has genuinely different plumbing and several
consumers, it may justify another private kit after the need is demonstrated.

## Develop

```sh
vp -C packages/runner-kit run check
vp -C packages/runner-kit run test
vp -C packages/runner-kit run typecheck
vp -C packages/runner-kit run build
```

After a public change, also run the tests for `@skillbench/runner-codex` and
`@skillbench/runner-claude`, its two consumers.
