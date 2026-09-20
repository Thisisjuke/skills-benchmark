# @thisisjuke/skillbench

## 0.3.0

### Minor Changes

- Add OpenCode as a CLI and Web runner backed by the user's installed, authenticated, and
  configured local OpenCode CLI. OpenCode profiles can specify `provider/model` or defer model
  resolution to OpenCode, accept an optional `variant`, use a restrictive per-run agent, and
  clean up their generated sessions.

  Runner configuration now uses an ordered `runners` list of complete profiles. Interactive
  commands offer the first profile by default, then let users select any saved profile or add
  and persist another one, including multiple profiles for the same provider. OpenCode leaves
  its model and reasoning effort unset by default and can therefore inherit its local CLI
  configuration; choosing a model and variant remains optional.

  This configuration change is not migrated automatically. Rename the former `runner`
  mapping to a one-item `runners` list, move any additional choices into complete list entries,
  and delete the former `models` section before running this version.

  Keep Claude support with restricted non-interactive execution and require Claude Code
  `>=2.1.259 <3.0.0`.

## 0.2.1

### Patch Changes

- Make project inputs explicit and editable: provide a runnable default eval and a valid multi-axis
  reference example, offer interactive eval and comparison-report template selectors, consolidate the
  qualitative judge into one richer skill, clarify repetition cost, show live runner progress, and
  highlight skipped merges. Invalid selections now fail before later prompts. Public tarballs omit
  development-only workspace metadata, and releases validate versioned changelog and upgrade notes
  before publication.

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
