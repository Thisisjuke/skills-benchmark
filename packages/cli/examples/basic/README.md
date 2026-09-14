# Complete offline example

This example compares two local skills, generates three merge candidates, runs the
development tournament, then opens the holdout only for the best parent and selected
candidate. Its configuration explicitly selects `MockRunner` and exercises a
Promptfoo output assertion: it uses no network, token, or Codex process.

From the monorepo root:

```sh
vp run skillbench -- compare ./packages/cli/examples/basic/skills/concise ./packages/cli/examples/basic/skills/detailed --evals ./packages/cli/examples/basic/evals/development --repeat 1
vp run skillbench -- merge ./packages/cli/examples/basic/skills/concise ./packages/cli/examples/basic/skills/detailed --evals ./packages/cli/examples/basic/evals/development --holdout ./packages/cli/examples/basic/evals/holdout --repeat 1
```

The mock runner gives the parents and candidates identical results here. Because
`merge.requireImprovement` is `true`, the expected result is `REJECTED` and the best
parent remains the winner. No file is written implicitly: the complete result is sent
to stdout. Add `--output ./result.skillbench` to materialize a portable bundle.

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
