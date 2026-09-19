# `@thisisjuke/skillbench`

`skillbench` is a CLI for answering practical questions about Agent Skills:

- What is actually inside this skill?
- Does it perform better than another skill on the same tasks?
- Can the strongest parts of two skills be merged without losing quality?

It accepts local folders or GitHub sources, resolves them to fingerprinted snapshots,
and runs reproducible evaluation suites. Use it as a one-off `npx` command; Promptfoo's
assertion engine is already included.

## Start with the core commands

| Command | Use it to… | Needs `init`? | Runs a model? |
| --- | --- | --- | --- |
| `inspect <skill>` | See a skill's metadata, files, source, and fingerprint | No | No |
| `init` | Create a self-contained Skillbench project in the current directory | — | No |
| `eval <skill>` | Run one skill against an evaluation suite | Yes | Yes, except with `mock` |
| `compare <skill-a> <skill-b>` | Evaluate two skills under the same conditions | Yes | Yes, except with `mock` |
| `merge <skill-a> <skill-b>` | Generate and rank candidates built from both skills | Yes | Yes, except with `mock` |
| `history` | List or rerun recent interactive comparisons | No | Only when rerunning |
| `doctor` | Check the local project and runner setup | No | No |

Run the CLI without installing it globally:

```sh
npx @thisisjuke/skillbench --help
npx @thisisjuke/skillbench <command> --help
```

Without a command in a TTY, Skillbench opens an interactive command selector. From
this monorepo, replace `npx @thisisjuke/skillbench` with `vp run skillbench --`.

## Keep each experiment in one project directory

Skillbench treats the current directory as the project you are working in. Initialize
it inside your own repository if the evaluation belongs with that codebase, or create
an empty directory for an isolated experiment:

```sh
mkdir skillbench-playground
cd skillbench-playground
npx @thisisjuke/skillbench init
```

`init` has no destination argument: change into the intended directory first. From
then on, everything Skillbench owns remains anchored to that project root:

| Location | Contents | Commit it? |
| --- | --- | --- |
| `.skillbench/config.yaml` | Runner, evaluation, and run-output configuration | Yes |
| `.skillbench/evals/development/example.yaml` | Starter scoring task and assertions to replace or extend | Yes |
| `.skillbench/assets.yaml` | Validated manifest for every model-facing project asset | Yes |
| `.skillbench/judge/SKILL.md` | Editable skill used for qualitative blind judging | Yes |
| `.skillbench/prompts/judge-instruction.txt` | Editable instruction sent to the judge | Yes |
| `.skillbench/templates/merge-candidate.md` | Editable merge-candidate template | Yes |
| `.gitignore` | Receives targeted rules for generated Skillbench state | Yes |
| `.skillbench/runs/` | Unique portable bundles from interactive operations | No |
| `.skillbench/tmp/`, `.skillbench/promptfoo/`, CLI history, and Web state | Generated local state | No |
| A path passed to `--output` | An exact portable bundle destination | Your choice |

The CLI is database-free. Editable inputs and generated state share the `.skillbench/`
namespace, but only the generated paths are ignored. Provider executables and their
authentication remain external to the project, as expected.

Missing parent directories are created automatically. Existing generated inputs are
reported as conflicts; after review, `init --force` replaces only the known starter
inputs and still preserves unrelated `.gitignore` rules.

Interactive `init` asks for a runner, its provider-specific profile, and where runs
should be saved; the default is `.skillbench/runs`. For a free deterministic workflow
check, initialize with the mock runner:

```sh
npx @thisisjuke/skillbench init --no-input
```

The mock runner proves that the workflow is wired correctly; it does not produce a
meaningful quality ranking. A fully explicit non-interactive Codex profile looks like:

```sh
npx @thisisjuke/skillbench init --no-input \
  --runner codex \
  --model gpt-5.6-luna \
  --reasoning-effort low
```

## Try the remote-skill journey

This journey exercises `inspect`, `compare`, and `merge` without cloning a repository
or creating any local skill files. The two examples deliberately use skills about the
same subject.

### 0. Create a disposable project

```sh
mkdir skillbench-playground
cd skillbench-playground
npx @thisisjuke/skillbench init --no-input
```

This keeps the experiment isolated and selects the free mock runner. Replace the last
command with interactive `init` if you want a meaningful Codex- or Claude-backed result.

### 1. Inspect a remote Thisisjuke skill

```sh
npx @thisisjuke/skillbench inspect \
  https://github.com/Thisisjuke/skills/tree/main/common/domain-modeling
```

This resolves the GitHub ref, discovers the skill, and writes a readable inspection
bundle. In interactive mode, a missing project is initialized once before the run. For
a transient inspection with no initialization or bundle, add `--no-input --no-output`.

### 2. Compare it with Matt Pocock's remote skill

```sh
npx @thisisjuke/skillbench compare \
  https://github.com/Thisisjuke/skills/tree/main/common/domain-modeling \
  https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling \
  --repeat 1
```

Skillbench downloads both sources into a temporary workspace below `.skillbench/`,
uses the starter `.skillbench/evals/development` suite, prints the comparison, and
saves a unique bundle below `.skillbench/runs/compare/`. `--repeat 1` keeps this first
run small.

### 3. Merge the same two remote skills

```sh
npx @thisisjuke/skillbench merge \
  https://github.com/Thisisjuke/skills/tree/main/common/domain-modeling \
  https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling \
  --repeat 1
```

The merge pipeline compares the parents, plans and generates candidates, then selects
the best result under the same development suite. The interactive run is saved
automatically. Use an explicit output directory when a stable path is more convenient:

```sh
npx @thisisjuke/skillbench merge \
  https://github.com/Thisisjuke/skills/tree/main/common/domain-modeling \
  https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling \
  --repeat 1 \
  --output ./results/domain-modeling.skillbench
```

With interactive Codex or Claude, Skillbench shows a preflight before paid calls. With
`init --no-input`, all three examples use the free mock runner and serve as a smoke test.

## Use local and remote sources

A skill source can be:

- a local directory or its `SKILL.md` file;
- `owner/repository` or `github:owner/repository/path@ref`;
- a GitHub repository, `tree`, `blob`, or `raw.githubusercontent.com` URL.

Local and remote inputs can be mixed:

```sh
npx @thisisjuke/skillbench compare \
  ./skills/local-skill \
  https://github.com/owner/repository/tree/main/skills/remote-skill
```

A GitHub branch or tag is resolved to an exact commit before download. If a repository
contains several `SKILL.md` files, interactive mode offers a choice. In automation, use
`--skill-path` for `inspect` or `eval`, and `--skill-path-a` / `--skill-path-b` for
`compare` or `merge`. `--offline` rejects every remote source.

## Define what a skill should accomplish

An eval YAML file defines one scoring task: the prompt given to the runner and the
assertions used to score its observable result. Keep development cases under
`.skillbench/evals/development/`; the starter generated by `init` is a commented,
loadable example.

```yaml
id: create-release-checklist
name: Create a release checklist
partition: development
prompt: Create RELEASE_CHECKLIST.md with a Release checklist heading.
assertions:
  - type: exit-code
    value: 0
  - type: file-exists
    value: RELEASE_CHECKLIST.md
  - type: contains
    path: RELEASE_CHECKLIST.md
    value: "# Release checklist"
```

`--evals` accepts one YAML file or a directory of `.yaml` and `.yml` files. Every case
loaded together must use the same `development` or `holdout` partition. Development
cases guide comparison and candidate selection; reserve separate holdout cases for the
final merge gate so they do not influence candidate creation. The preflight prints the
resolved suite path, partition, case count, repetitions, and estimated model calls.

## Choose a runner and control cost

The registered runners are `mock`, `codex`, and `claude`.

- `mock` is free and deterministic. Use it to validate configuration and automation.
- `codex` and `claude` require their installed and authenticated executable.
- Model and reasoning effort are explicit; Skillbench does not silently inherit a
  personal model choice.

Codex accepts `minimal`, `low`, `medium`, `high`, or `xhigh` reasoning effort. Claude
accepts `low`, `medium`, `high`, `xhigh`, or `max`. The mock runner uses neither a model
nor reasoning effort.

In interactive mode, the preflight shows resolved sources, fingerprints or commits,
suite, repetitions, runner profile, and estimated call count. `--yes` accepts that
preflight in automation but never fills in a missing runner value.

When `.skillbench/config.yaml` contains a complete runner profile, an interactive
command first offers to reuse it and shows the runner, model, effort, and sandbox.
Accepting skips the detailed profile questions. Declining selects a one-run override
without rewriting the project configuration.

```sh
npx @thisisjuke/skillbench \
  --runner codex \
  --model gpt-5.6-luna \
  --reasoning-effort low \
  --no-input \
  --yes \
  compare ./skill-a ./skill-b \
  --repeat 1
```

If a flag selects a different provider from `.skillbench/config.yaml`, also provide that
provider's model and reasoning effort. Values are never reused across providers.

## Understand outputs

Interactive `inspect`, `eval`, `compare`, and `merge` commands print a human-readable
result and save a collision-free bundle under
`<outputs.directory>/<command>/<timestamp-id>.skillbench`. The default configured
directory is `.skillbench/runs`. Machine-oriented and non-interactive commands do not
save implicitly; pass `--output` when automation needs a bundle.

| Option | Output |
| --- | --- |
| `--json` | One versioned final result on stdout |
| `--jsonl` | Versioned progress events used by integrations and the Web product |
| `--debug` | Sanitized diagnostics and stack traces on stderr |
| `--output <directory>` | Write atomically to this exact directory instead of the automatic run path |
| `--no-output` | Do not save the automatic bundle for an interactive operation |
| `--force` | Replace the output only if it is already an identifiable Skillbench bundle |

`--json` and `--jsonl` are mutually exclusive. Relative output paths are resolved from
the project root. An explicit non-empty destination fails unless `--force` identifies
it as an existing Skillbench bundle. Automatic destinations are always unique, so the
same command can be repeated without collisions.

Every bundle starts with `report.md`, followed by the structured result and its
integrity manifest:

```text
<run>.skillbench/
├── report.md
├── manifest.json
├── result.json
├── sources/
├── reports/
├── artifacts/
└── instructions/
```

Open `report.md` first. `manifest.json` records paths, sizes, and SHA-256 hashes, while
`result.json` preserves the machine-readable result. A merge bundle writes every
generated skill below `artifacts/candidates/`, copies the development winner to
`artifacts/recommended/`, and creates `artifacts/final/` only when a holdout gate
accepts a candidate.

```sh
npx @thisisjuke/skillbench inspect ./skill --json
npx @thisisjuke/skillbench compare ./skill-a ./skill-b \
  --output ./results/comparison.skillbench
npx @thisisjuke/skillbench merge ./skill-a ./skill-b \
  --comparison ./results/comparison.skillbench \
  --output ./results/merge.skillbench
```

## Revisit recent comparisons

Only successful interactive comparisons enter the ten-item MRU. History contains the
command profile, not result data, skill content, tokens, or environment variables.

```sh
npx @thisisjuke/skillbench history
npx @thisisjuke/skillbench history --json
npx @thisisjuke/skillbench history --rerun <id>
```

In a TTY, select an entry with the arrow keys and press Enter to rerun it after a new
preflight. `--no-history` disables both reads and writes. The Web application always
uses that option because it owns separate SQLite history.

## CLI reference

Put global options before the command in scripts. Every command also exposes its own
`--help` page.

| Global option | Purpose |
| --- | --- |
| `-c, --config <path>` | Use an explicit YAML config; `.skillbench/config.yaml` is the only automatically discovered path |
| `--debug` | Add sanitized diagnostics to stderr |
| `--offline` | Reject remote sources and network access |
| `--runner <mock\|codex\|claude>` | Override `runner.type` |
| `--model <id>` | Set the required Codex or Claude model |
| `--reasoning-effort <value>` | Set the provider-specific effort level |
| `--no-input` | Disable every prompt and fail when a required value is missing |
| `--no-history` | Disable the comparison MRU |
| `--jsonl` | Emit only versioned events on stdout |
| `-y, --yes` | Accept a fully determined paid-run preflight |

Common command options:

| Option | Commands | Purpose |
| --- | --- | --- |
| `--evals <path>` | `eval`, `compare`, `merge` | Read YAML scoring tasks and assertions; defaults to `.skillbench/evals/development` |
| `--partition <development\|holdout>` | `eval`, `compare` | Require the loaded suite to match that partition |
| `--repeat <1..100>` | `eval`, `compare`, `merge` | Override `eval.repeat`, whose built-in default is `3` |
| `--keep-workspaces` | `eval`, `compare` | Retain execution directories below `.skillbench/tmp` |
| `--holdout <path>` | `merge` | Add a holdout gate after development selection |
| `--comparison <path>` | `merge` | Reuse a compatible comparison result or bundle |
| `-o, --output <directory>` | Operations | Use this exact bundle path relative to the project root |
| `--no-output` | Operations | Disable the automatic bundle in interactive mode |
| `--force` | Operations | Replace an existing identifiable bundle; requires `--output` |
| `--json` | Commands | Emit one versioned final result |

Configuration-only controls—sandbox, timeouts, weights, judge behavior, merge
thresholds, reports, and source size limits—are documented in
[`skillbench.example.yaml`](skillbench.example.yaml).
`reports.markdown` controls whether the comparison report is embedded in the structured
comparison result; every saved bundle still has its root `report.md`.

## Integrate with another product

Backends can use three supported package subpaths:

```ts
import {
  skillbenchAutomationRequestSchema,
  skillbenchEventSchema,
} from "@thisisjuke/skillbench/contracts";
import { skillbenchBundleManifestSchema } from "@thisisjuke/skillbench/contracts/bundles";
import { resolveSkillbenchCliPath } from "@thisisjuke/skillbench/cli-path";
```

`contracts` owns automation requests, command and runner identifiers, result envelopes,
and JSONL events. `contracts/bundles` owns the portable manifest. `cli-path` resolves
the executable installed with the package for a Node.js subprocess caller. These are
the only supported source-level entrypoints; consumers must not import internal
`@skillbench/*` packages or resolve `dist/cli.mjs` themselves.

A backend should validate a request, map it to documented flags, invoke the CLI, then
validate its JSONL events and bundle. The Web product always adds `--no-input`,
`--no-history`, `--jsonl`, `--yes`, and a temporary `--output` directory. It deliberately
does not expose `init`, `history`, arbitrary flags, or arbitrary output paths.

## Maintain this package

### Workspace contract

- **Status:** public npm product exposing the `skillbench` binary and documented
  contract subpaths.
- **Owns:** terminal UX, automation entry, product composition, initialization, CLI
  history, and portable bundles.
- **Does not own:** SQLite, Web lifecycle, provider implementations, or
  provider-independent domain rules.
- **Depends on:** invocation contract, SDK, runner/source/assertion adapters, and test
  contracts for tests only. Private production modules are bundled.
- **Direct dependent:** the Web product, through published surfaces only.

### Package map

```text
src/application/          typed operations and ports
src/application/merge/    comparison, planning, generation, tournament, holdout, writes
src/composition/          adapter composition and runner registry
src/cli/commands/         arguments and prompts mapped to application requests
src/cli/renderers/        human-only terminal summaries
src/cli/                  Commander, Clack, output modes, and error presentation
src/bundles/              atomic writes for automatic and explicit outputs
src/config/               .skillbench/config.yaml loading and validation
src/history/              bounded CLI MRU
src/init/                 starter file generation
src/assets/               project instruction manifest and asset loading
src/project/              project root, local state, and Promptfoo environment
defaults/                 packaged inputs copied into a project by init
```

The application layer does not depend on Commander or Clack. Start with the
[`src/application/` map](src/application/README.md) for use cases and the [`src/cli/`
map](src/cli/README.md) for terminal behavior.

To add a runner, create its adapter and profile, then register one provider definition
in the composition registry. To add a source, implement the SDK port in an adapter and
connect it in composition. Model-facing prompts, rubrics, skills, and templates belong
under `defaults/project`, are copied by `init`, and are referenced by
`.skillbench/assets.yaml`; `vp run instructions` guards that ownership.

### Dependency and artifact policy

Promptfoo is intentionally the largest part of the installed dependency tree. Only its
assertion runtime is reached through the allowlisted adapter. SQLite drivers, Web
assets, private test contracts, and workspace source files must not enter the CLI
artifact.

```sh
pnpm --filter @thisisjuke/skillbench why promptfoo
pnpm --filter @thisisjuke/skillbench pack --dry-run
vp run smoke:release
```

### Develop and verify

From the monorepo root:

```sh
vp -C packages/cli run check
vp -C packages/cli run test
vp -C packages/cli run typecheck
vp -C packages/cli run build
```

Run `vp run smoke:release` after packaging changes. Versioning and publication belong
to the [monorepo root](../../README.md#distribution-and-releases); do not publish this
workspace independently.

Live tests are opt-in:

```sh
vp -C packages/cli run test:github-live
vp -C packages/cli run test:codex-live
```

The [complete configuration](skillbench.example.yaml) and [offline
example](examples/basic/README.md) are maintained with this package.
