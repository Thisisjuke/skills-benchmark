# Complete offline example

This example compares two local skills, generates three merge candidates, runs the
development tournament, then opens the holdout only for the best parent and selected
candidate. Its configuration explicitly selects `MockRunner` and exercises a
Promptfoo output assertion: it uses no network, token, or provider CLI process.

From the monorepo root:

```sh
vp run skillbench -- --config ./packages/cli/examples/basic/skillbench.yaml compare ./skills/concise ./skills/detailed --evals ./evals/development --repeat 1
vp run skillbench -- --config ./packages/cli/examples/basic/skillbench.yaml merge ./skills/concise ./skills/detailed --evals ./evals/development --holdout ./evals/holdout --repeat 1
```

The mock runner gives the parents and candidates identical results here. Because
`merge.requireImprovement` is `true`, the expected holdout result is `REJECTED` and the
best parent remains the winner. Interactive runs are saved below this example's
`.skillbench/runs/` directory. Open the generated `report.md` first; the merge bundle
contains all candidates under `artifacts/candidates/` and the development winner under
`artifacts/recommended/`, but no `artifacts/final/` because the holdout rejected it.

Add `--no-output` for a transient interactive run, or
`--output ./result.skillbench` for a stable bundle path relative to this example.

To start over without modifying this source directory, copy it to a temporary
directory:

```sh
destination="$(mktemp -d)/skillbench-basic"
cp -R . "$destination"
cd "$destination"
```

The development suite contains a `command` assertion. Skillbench executes it directly,
without an implicit shell, but does not provide a complete security sandbox in V1: use
only suites, fixtures, and repositories that you trust.
