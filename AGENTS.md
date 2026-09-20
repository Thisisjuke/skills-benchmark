# Repository instructions

## Project

- This is a Vite+ monorepo for two public products: `@thisisjuke/skillbench` and
  `@thisisjuke/skillbench-web`. Private `@skillbench/*` workspaces are bundled internals.
- Use Node.js 22.22.2 or newer, pnpm 11.24.0, and Vite+ as the task orchestrator.
- Read [`packages/README.md`](packages/README.md) before changing package ownership or
  dependency direction.

## Boundaries

- Keep provider-independent behavior in the SDK, provider behavior in adapters,
  terminal composition in the CLI, and SQLite persistence in the Web application.
- Declare internal dependencies with `workspace:*`; never import another workspace's
  `src` directory.
- Keep model-facing runtime instructions under `packages/cli/defaults/project` and
  reference them through `skillbench/assets.yaml`.
- Preserve unrelated working-tree changes. Do not commit, tag, publish, or push unless
  the user explicitly asks.

## Commands

- Run workspace tasks with `vp -C <workspace> run <task>`.
- Use focused workspace checks while iterating and `vp run check` for the full gate when
  the scope warrants it. Live provider tests are opt-in.
- Run `vp run boundaries` after dependency changes, `vp run instructions` after runtime
  instruction changes, and `vp run smoke:release` after packaging changes.
- Add a changeset for user-visible CLI or Web changes.

## Releases

- Before creating `vX.Y.Z`, add a non-empty `.github/releases/vX.Y.Z.md` based on
  `.github/releases/TEMPLATE.md`.
- Release notes must include a user-facing `## Changelog` and an `## Upgrade` or migration
  section. Include copyable migration commands whenever project layout or configuration changes.
- The tag, CLI version, Web version, and notes filename must match exactly. The release workflow
  validates this contract before any npm publication and creates or updates the GitHub Release
  from that exact Markdown file after publication succeeds.
