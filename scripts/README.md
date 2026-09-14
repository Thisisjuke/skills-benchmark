# Repository scripts

This directory contains the few operational checks and package-consumer probes that span more
than one workspace. Product behavior belongs in its owning workspace, and ordinary task ordering
belongs to Vite+.

## Ownership

- `check-workspace-boundaries.mjs` is the single architecture guard for invariants that manifests,
  TypeScript, package exports, and Vite+ cannot fully express: permitted internal edges, forbidden
  layer dependencies, source-boundary escapes, public product surfaces, the fixed Changesets
  release group, and bundling rules.
- `check-runtime-instructions.mjs` validates the model-facing instruction inventory and prevents
  hidden runtime fallbacks.
- `smoke-release.mjs` is the only release-smoke entrypoint. It inspects and packs both public
  products exactly once, invokes their external-consumer probes, and records the accepted paths
  and SHA-512 integrities in `artifacts/release-artifacts.json`.
- `smoke-cli-package.mjs` and `smoke-web-package.mjs` are implementation helpers that require
  explicit tarball paths from `smoke-release.mjs`; they never pack or build independently.

Keep scripts finite, deterministic, cross-platform, and rooted from `import.meta.url`. Do not add
manual workspace build ordering, repository projection, publication, or product-specific business
logic here. Prefer a manifest constraint, TypeScript, package export, or Vite+ task edge whenever
it can provide the same failure signal.

Run the architecture and instruction guards with `vp run boundaries` and `vp run instructions`.
Run the complete package contract with `vp run smoke:release`.
