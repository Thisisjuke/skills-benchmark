# `@skillbench/assertions-promptfoo`

This package adapts a deterministic subset of Promptfoo output assertions to
Skillbench's `AssertionHandler` contract. Promptfoo owns no orchestration, cache,
persistence, or runner execution here.

This is a private development boundary bundled into the public CLI product. Users
install Skillbench once and do not install this adapter or Promptfoo separately.

## Workspace contract

- **Status:** private production adapter, bundled into the CLI.
- **Owns:** the safe Promptfoo assertion subset and normalization to SDK results.
- **Does not own:** evaluation orchestration, providers, runners, cache, or persistence.
- **Internal dependencies:** SDK; `test-contracts` for tests only.
- **Direct dependent:** CLI composition and packaging.
- **Extension point:** add a deterministic assertion admitted by the SDK schema, or create a
  sibling adapter for an engine with different runtime risk.

The CLI enables this engine by default when a suite explicitly contains:

```yaml
assertions:
  - type: promptfoo
    assertion:
      type: is-json
      metric: structured-output
```

The public API exposes `PromptfooAssertionEngine`, `PROMPTFOO_VERSION`, and the
`PromptfooRunAssertion` type. The latter lets tests inject the Promptfoo call without
loading its real runtime.

## Allowed scope

The SDK's public schema is the allowlist. It accepts the text comparisons, searches,
regular expressions, JSON, XML, HTML, SQL, word counts, and Levenshtein distance
assertions listed in `@skillbench/sdk/evaluator`.

Assertions that execute JavaScript, Python, Ruby, a webhook, a provider, or an LLM
grader are rejected. The Skillbench core continues to manage files, commands,
repetitions, workspaces, and holdouts.

The engine receives only the output, latency, prompt, and tokens already produced by
`Runner`. It normalizes the Promptfoo result into a versioned `AssertionResult` and
bounds the score between 0 and 1.

## Modify the adapter

A new assertion must first be admitted to the SDK schema, with a justification of its
determinism and effects. Then extend the adapter and its tests. Never import Promptfoo's
orchestrator, providers, or cache to bypass the allowlist.

The Promptfoo version in this package's `dependencies` is the canonical version. Runtime
evidence derives from that manifest, and the workspace boundary check requires the public
CLI dependency to match it exactly. Its installation tree is large and may contain
transitive dependencies that the allowlist cannot reach; run `npm audit` and the isolated
smoke test for every update. Do not hide an advisory with an automatic, incompatible
downgrade.

## Create another assertion engine

Create a sibling package when the engine brings its own dependency or runtime risk:

1. implement an `AssertionHandler` or a handler facade;
2. keep the assertion document and its schema in the SDK;
3. normalize every output to `AssertionResult`;
4. apply `verifyAssertionHandlerContract`;
5. register the handler at the CLI composition point;
6. isolate its dependencies and verify the public product package smokes.

## Develop

```sh
vp -C packages/assertions-promptfoo run check
vp -C packages/assertions-promptfoo run test
vp -C packages/assertions-promptfoo run typecheck
vp -C packages/assertions-promptfoo run build
```
