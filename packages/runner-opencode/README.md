# `@skillbench/runner-opencode`

This private adapter implements the SDK `Runner` port through an already installed,
authenticated, and configured OpenCode CLI. It is bundled into the public Skillbench
products and is not published separately.

OpenCode execution uses `opencode run --format json --pure` with an optional explicit
`provider/model`, an optional provider-specific `variant`, and a generated `skillbench`
agent. When no model is supplied, the adapter omits `--model` and lets OpenCode resolve
the model from its own configuration. The adapter inherits the user's OpenCode provider
configuration and process environment. It never installs OpenCode, logs in, refreshes
the model catalog, or edits global configuration.

## Safety and reproducibility contract

- each attempt uses a fresh Skillbench workspace and `.opencode/skills` entry;
- the generated agent denies shell, network, subagents, questions, external directories,
  MCP tools, and unknown tools;
- `workspace-write` enables only structured edit tools; `read-only` denies edits;
- `--pure` disables external plugins, but global OpenCode configuration and instructions
  may still influence behavior;
- omitting the model also makes model selection dependent on the user's OpenCode state;
- every run has a unique session title and its exact session is deleted afterward;
- JSONL, process output, duration, artifacts, usage, and provider trace data are bounded.

This is therefore a **trusted local configuration** runner, not a hermetic runner. Never
use `--auto` or advertise OpenCode permissions as an operating-system sandbox.

Supported CLI versions are `>=1.18.12 <2.0.0`. Treat a protocol or major-version change
as an adapter change and update the fake executable, parser, version gate, and live test
together.

## Develop

```sh
vp -C packages/runner-opencode run check
vp -C packages/runner-opencode run test
```

The opt-in live test consumes model tokens and requires an existing OpenCode setup:

```sh
SKILLBENCH_OPENCODE_MODEL=provider/model \
  vp -C packages/runner-opencode run test:live
```
