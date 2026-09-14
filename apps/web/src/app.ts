import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { serveStatic } from "@hono/node-server/serve-static";
import * as z from "zod";

import { JobManager, webJobRequestSchema } from "./jobs";
import { WebRepository } from "./storage";

const sourceInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["local", "github"]),
  source: z.string().trim().min(1),
  skillPath: z.string().trim().min(1).optional(),
});

export type CreateWebAppOptions = {
  jobs: JobManager;
  repository: WebRepository;
  assetsRoot?: string;
  now?: () => Date;
  id?: () => string;
};

export function createWebApp(options: CreateWebAppOptions): Hono {
  const app = new Hono();
  const now = options.now ?? (() => new Date());
  const id = options.id ?? (() => crypto.randomUUID());

  app.use("/api/*", async (context, next) => {
    const origin = context.req.header("origin");
    if (origin !== undefined && !isLoopbackOrigin(origin)) {
      return context.json(
        { error: { code: "WEB_ORIGIN_FORBIDDEN", message: "Origin denied" } },
        403,
      );
    }
    await next();
  });

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.get("/api/jobs", (context) => context.json({ jobs: options.repository.listJobs() }));
  app.get("/api/jobs/:id", (context) => {
    try {
      const job = options.repository.requireJob(context.req.param("id"));
      return context.json({
        job,
        events: options.repository.listEvents(job.id),
        run: options.repository.getRunDetails(job.id),
      });
    } catch {
      return context.json({ error: { code: "WEB_JOB_NOT_FOUND", message: "Job not found" } }, 404);
    }
  });
  app.post("/api/jobs", zValidator("json", webJobRequestSchema), (context) => {
    const job = options.jobs.create(context.req.valid("json"));
    return context.json({ job }, 202);
  });
  app.post("/api/jobs/:id/rerun", (context) => {
    try {
      const previous = options.repository.requireJob(context.req.param("id"));
      const request = webJobRequestSchema.parse(previous.request);
      return context.json({ job: options.jobs.create(request) }, 202);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json(
          { error: { code: "WEB_JOB_REQUEST_INVALID", message: "Stored job request is invalid" } },
          409,
        );
      }
      return context.json({ error: { code: "WEB_JOB_NOT_FOUND", message: "Job not found" } }, 404);
    }
  });
  app.post("/api/jobs/:id/cancel", (context) => {
    try {
      const cancelled = options.jobs.cancel(context.req.param("id"));
      return context.json({ cancelled }, cancelled ? 202 : 409);
    } catch {
      return context.json({ error: { code: "WEB_JOB_NOT_FOUND", message: "Job not found" } }, 404);
    }
  });
  app.get("/api/jobs/:id/events", (context) => {
    const jobId = context.req.param("id");
    try {
      options.repository.requireJob(jobId);
    } catch {
      return context.json({ error: { code: "WEB_JOB_NOT_FOUND", message: "Job not found" } }, 404);
    }
    const parsedAfter = Number.parseInt(context.req.query("after") ?? "0", 10);
    const initialAfter = Number.isSafeInteger(parsedAfter) && parsedAfter >= 0 ? parsedAfter : 0;
    return streamSSE(context, async (stream) => {
      let cursor = initialAfter;
      while (!stream.aborted) {
        for (const event of options.repository.listEvents(jobId, cursor)) {
          cursor = event.sequence;
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.event,
            data: JSON.stringify(event.payload),
          });
        }
        const job = options.repository.requireJob(jobId);
        if (["completed", "failed", "cancelled", "interrupted"].includes(job.status)) break;
        await stream.sleep(200);
      }
    });
  });

  app.get("/api/sources", (context) => context.json({ sources: options.repository.listSources() }));
  app.post("/api/sources", zValidator("json", sourceInputSchema), (context) => {
    const validated = context.req.valid("json");
    const source = options.repository.saveSource({
      id: id(),
      label: validated.label,
      kind: validated.kind,
      source: validated.source,
      ...(validated.skillPath === undefined ? {} : { skillPath: validated.skillPath }),
      now: now().toISOString(),
    });
    return context.json({ source }, 201);
  });
  app.delete("/api/sources/:id", (context) => {
    const deleted = options.repository.deleteSource(context.req.param("id"));
    return deleted
      ? context.json({ deleted: true })
      : context.json({ error: { code: "WEB_SOURCE_NOT_FOUND", message: "Source not found" } }, 404);
  });
  app.get("/api/runs/:runId/files/:kind/:id", (context) => {
    const kind = context.req.param("kind");
    if (kind !== "report" && kind !== "artifact") {
      return context.json(
        { error: { code: "WEB_FILE_NOT_FOUND", message: "File not found" } },
        404,
      );
    }
    const record = options.repository.getRunFile(
      context.req.param("runId"),
      kind,
      context.req.param("id"),
    );
    if (record === undefined) {
      return context.json(
        { error: { code: "WEB_FILE_NOT_FOUND", message: "File not found" } },
        404,
      );
    }
    const bundleRoot = resolve(record.run.bundlePath);
    const filePath = resolve(bundleRoot, record.file.path);
    if (
      !filePath.startsWith(`${bundleRoot}${sep}`) ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      return context.json(
        { error: { code: "WEB_FILE_INVALID", message: "Stored file is invalid" } },
        409,
      );
    }
    const bytes = readFileSync(filePath);
    context.header("Content-Type", record.mediaType);
    context.header(
      "Content-Disposition",
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`,
    );
    return context.body(bytes);
  });

  if (options.assetsRoot === undefined) {
    app.get("/", (context) =>
      context.html(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skillbench</title></head><body><main><h1>Skillbench Web</h1><p>Le serveur local est prêt.</p></main></body></html>`,
      ),
    );
  } else {
    const serveAssets = serveStatic({ root: options.assetsRoot });
    app.use("/assets/*", async (context, next) => {
      context.header("Cache-Control", "public, max-age=31536000, immutable");
      return serveAssets(context, next);
    });
    app.get("/", serveStatic({ root: options.assetsRoot, path: "index.html" }));
  }
  app.notFound((context) =>
    context.json({ error: { code: "WEB_NOT_FOUND", message: "Route not found" } }, 404),
  );
  return app;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
