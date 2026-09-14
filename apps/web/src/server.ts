#!/usr/bin/env node

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";

import packageJson from "../package.json" with { type: "json" };
import { createWebApp } from "./app";
import { JobManager } from "./jobs";
import { WebDatabase, WebRepository } from "./storage";

type Options = { project: string; port: number; open: boolean };

const program = new Command()
  .name("skillbench-web")
  .description("Start the local persistent Skillbench interface")
  .version(packageJson.version)
  .option("--project <path>", "project directory", process.cwd())
  .option("--port <port>", "loopback port", parsePort, 4173)
  .option("--no-open", "do not open the browser")
  .parse();

const options = program.opts<Options>();
const projectPath = resolve(options.project);
if (!statSync(projectPath).isDirectory())
  throw new Error(`Project is not a directory: ${projectPath}`);

const database = new WebDatabase(projectPath);
const repository = new WebRepository(database);
const jobs = new JobManager({ projectPath, repository });
const assetsRoot = fileURLToPath(new URL("./client", import.meta.url));
const app = createWebApp({ jobs, repository, assetsRoot });
const server = serve(
  { fetch: app.fetch, hostname: "127.0.0.1", port: options.port },
  async (info) => {
    const url = `http://127.0.0.1:${info.port}`;
    process.stdout.write(`Skillbench Web: ${url}\nProject: ${projectPath}\n`);
    if (options.open) await open(url);
  },
);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await jobs.shutdown();
  server.close(() => {
    database.close();
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}
