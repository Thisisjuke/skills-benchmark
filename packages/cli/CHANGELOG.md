# @thisisjuke/skillbench

## 0.2.0

### Minor Changes

- Offer one compact confirmation to reuse the configured runner in interactive commands, while
  keeping explicit profile flags and non-interactive execution deterministic.
- Add a readable root `report.md` to every result bundle, materialize every merge candidate, and
  separate the development recommendation from the holdout-approved final skill. Validate every
  manifest-referenced file before the Web application persists a completed run.
- Clarify how eval suites score skills with explicit prompts, an annotated starter case, resolved
  preflight metadata, and actionable errors for missing, empty, invalid, or mispartitioned suites.
- Move generated project configuration, evaluations, and runtime assets into the canonical
  `.skillbench` layout, persist the selected runs directory, and initialize interactive
  inspection journeys once for reuse by later commands.
- Save interactive inspect, eval, compare, and merge runs automatically to unique command-specific
  directories, with `--no-output` available to opt out while preserving explicit output safety.

## 0.1.1

### Patch Changes

- Accept the recommended model when an interactive runner prompt is submitted unchanged.
