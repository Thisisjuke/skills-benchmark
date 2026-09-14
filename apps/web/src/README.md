# Web source map

This directory owns the `@thisisjuke/skillbench-web` runtime. The product persists local state but
delegates Skillbench operations to the installed CLI through its public binary and contracts.

## Request and data flow

```text
React client → Hono routes → JobManager → skillbench subprocess / JSONL / bundle
                         └→ WebRepository → WebDatabase → Drizzle migrations
```

| Area | Owns |
| --- | --- |
| `client/` | React application, query lifecycle, page-level interaction states |
| `components/ui/` | locally owned shadcn/Base UI primitives |
| `app.ts` | loopback HTTP routes, request validation, SSE, static assets |
| `jobs/` | validated request-to-argv mapping, queueing, cancellation, JSONL and bundle intake |
| `storage/` | SQLite lifecycle, Drizzle schema, repositories, startup recovery |
| `server.ts` | executable options, loopback listener, browser launch, graceful shutdown |

Only `@thisisjuke/skillbench/cli-path` and the documented contract subpaths cross the product
boundary. Web must not import private `@skillbench/*` packages or CLI source. Routes do not accept
arbitrary argv; jobs construct it from validated requests. Components do not access SQLite or
spawn processes.

Extend the narrowest owning area, then verify its neighbors: route and job changes need request,
JSONL, cancellation, and persistence coverage; schema changes require a generated migration;
client changes must cover loading, empty, error, success, and cancellation states.

Run `vp -C apps/web run check` from the repository root.
