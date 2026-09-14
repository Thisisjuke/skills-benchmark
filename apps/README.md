# Application map

`apps/` contains user-facing applications that own a runtime or persistence boundary. There is
currently one application:

| Workspace | Status | Owns | Depends on |
| --- | --- | --- | --- |
| [`@thisisjuke/skillbench-web`](web/README.md) | public npm product | loopback server, React interface, jobs, SQLite persistence, migrations | the public `@thisisjuke/skillbench` package |

Web invokes the CLI as a subprocess through its published binary and contracts. It must not import
private `@skillbench/*` workspaces or CLI implementation files. See the [source ownership
map](web/src/README.md) before changing routes, jobs, UI, or storage.

From the repository root, use `vp run dev` for development and `vp run build` for the complete
product build. Package-specific checks use `vp -C apps/web run check`.
