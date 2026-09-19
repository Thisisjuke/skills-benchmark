import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";
import * as z from "zod";

import { SkillbenchError, toErrorMessage } from "../errors";
import { hashBytes } from "../skills";
import { evalCaseDocumentSchema } from "./schema";
import type { EvalCase, EvalPartition, EvalSuite } from "./types";

export type LoadEvalSuiteOptions = {
  partition?: EvalPartition;
};

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function discoverYamlFiles(inputPath: string): { rootPath: string; files: string[] } {
  let stats;
  try {
    stats = lstatSync(inputPath);
  } catch (error) {
    throw new SkillbenchError(
      `Eval path not found: ${inputPath}. Create it or provide the path to an existing YAML eval file or directory.`,
      {
        code: "EVAL_PATH_NOT_FOUND",
        cause: error,
      },
    );
  }
  if (stats.isSymbolicLink()) {
    throw new SkillbenchError(`Eval path cannot be a symbolic link: ${inputPath}`, {
      code: "EVAL_PATH_SYMLINK",
    });
  }
  if (stats.isFile()) {
    if (!new Set([".yaml", ".yml"]).has(extname(inputPath).toLowerCase())) {
      throw new SkillbenchError(`Eval file must use .yaml or .yml: ${inputPath}`, {
        code: "EVAL_FILE_EXTENSION",
      });
    }
    return { rootPath: dirname(inputPath), files: [inputPath] };
  }
  if (!stats.isDirectory()) {
    throw new SkillbenchError(`Eval path must be a YAML file or directory: ${inputPath}`, {
      code: "EVAL_PATH_INVALID",
    });
  }

  const files: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SkillbenchError(`Eval suite cannot contain symbolic links: ${path}`, {
          code: "EVAL_PATH_SYMLINK",
        });
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && new Set([".yaml", ".yml"]).has(extname(path).toLowerCase())) {
        files.push(path);
      }
    }
  };
  visit(inputPath);
  if (files.length === 0) {
    throw new SkillbenchError(
      `No YAML eval files found in: ${inputPath}. Add at least one .yaml or .yml eval file.`,
      { code: "EVAL_SUITE_EMPTY" },
    );
  }
  return { rootPath: inputPath, files };
}

function inferPartition(path: string): EvalPartition | undefined {
  const segments = resolve(path).split(sep);
  const matches = segments.filter(
    (segment): segment is EvalPartition => segment === "development" || segment === "holdout",
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
    .join("; ");
}

function fingerprintFixture(sourcePath: string, suiteRoot: string): string {
  const realRoot = realpathSync(suiteRoot);
  const realSource = realpathSync(sourcePath);
  if (!isWithin(realRoot, realSource)) {
    throw new SkillbenchError(`Eval fixture resolves outside suite root: ${sourcePath}`, {
      code: "EVAL_FIXTURE_UNSAFE",
    });
  }
  const entries: Array<readonly [string, string, number]> = [];
  const visit = (path: string, relativePath: string): void => {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new SkillbenchError(`Eval fixture tree contains a symbolic link: ${path}`, {
        code: "EVAL_FIXTURE_UNSAFE",
      });
    }
    if (stats.isDirectory()) {
      const children = readdirSync(path).sort((left, right) => left.localeCompare(right, "en"));
      for (const child of children) {
        visit(resolve(path, child), relativePath === "." ? child : `${relativePath}/${child}`);
      }
      return;
    }
    if (stats.isFile()) {
      const content = new Uint8Array(readFileSync(path));
      entries.push([relativePath, hashBytes(content), content.byteLength]);
    }
  };
  visit(sourcePath, ".");
  return hashBytes(new TextEncoder().encode(JSON.stringify(entries)));
}

export function loadEvalSuite(input: string, options: LoadEvalSuiteOptions = {}): EvalSuite {
  const inputPath = resolve(input);
  const { rootPath, files } = discoverYamlFiles(inputPath);
  const directoryPartition = inferPartition(inputPath);
  const cases: EvalCase[] = [];
  const ids = new Map<string, string>();

  for (const sourcePath of files) {
    const bytes = new Uint8Array(readFileSync(sourcePath));
    let document;
    try {
      document = evalCaseDocumentSchema.parse(parseYaml(new TextDecoder().decode(bytes)));
    } catch (error) {
      const details = error instanceof z.ZodError ? formatZodError(error) : toErrorMessage(error);
      throw new SkillbenchError(
        `Invalid eval ${sourcePath}: ${details}. Fix this YAML file so it defines an id, name, prompt, and at least one supported assertion.`,
        {
          code: "EVAL_VALIDATION_ERROR",
          cause: error,
        },
      );
    }

    const partition = document.partition ?? options.partition ?? directoryPartition;
    if (partition === undefined) {
      throw new SkillbenchError(
        `Eval partition is ambiguous for ${sourcePath}. Add "partition: development" or "partition: holdout", or move the file into a matching directory.`,
        { code: "EVAL_PARTITION_AMBIGUOUS" },
      );
    }
    if (
      document.partition !== undefined &&
      directoryPartition !== undefined &&
      document.partition !== directoryPartition
    ) {
      throw new SkillbenchError(
        `Eval partition ${document.partition} conflicts with the ${directoryPartition} directory for ${sourcePath}. Change the file partition to ${directoryPartition} or move it into a ${document.partition} directory.`,
        { code: "EVAL_PARTITION_CONFLICT" },
      );
    }
    if (
      document.partition !== undefined &&
      options.partition !== undefined &&
      document.partition !== options.partition
    ) {
      throw new SkillbenchError(
        `Eval partition ${document.partition} does not match requested partition ${options.partition} for ${sourcePath}. Change the file partition or request ${document.partition}.`,
        { code: "EVAL_PARTITION_CONFLICT" },
      );
    }
    if (
      options.partition !== undefined &&
      directoryPartition !== undefined &&
      options.partition !== directoryPartition
    ) {
      throw new SkillbenchError(
        `Requested partition ${options.partition} conflicts with the ${directoryPartition} directory for ${sourcePath}. Request ${directoryPartition} or choose a matching suite directory.`,
        { code: "EVAL_PARTITION_CONFLICT" },
      );
    }
    if (ids.has(document.id)) {
      throw new SkillbenchError(
        `Duplicate eval id "${document.id}" in ${ids.get(document.id)} and ${sourcePath}. Give each eval file a unique id.`,
        { code: "EVAL_ID_DUPLICATE" },
      );
    }
    ids.set(document.id, sourcePath);

    const fixtureFingerprints: string[] = [];
    const fixtures = document.fixtures.map((fixture) => {
      const source = resolve(dirname(sourcePath), fixture.source);
      if (!isWithin(rootPath, source)) {
        throw new SkillbenchError(`Eval fixture escapes suite root: ${fixture.source}`, {
          code: "EVAL_FIXTURE_UNSAFE",
        });
      }
      try {
        const fixtureStats = lstatSync(source);
        if (fixtureStats.isSymbolicLink()) {
          throw new SkillbenchError(`Eval fixture cannot be a symbolic link: ${fixture.source}`, {
            code: "EVAL_FIXTURE_UNSAFE",
          });
        }
      } catch (error) {
        if (error instanceof SkillbenchError) throw error;
        throw new SkillbenchError(`Eval fixture not found: ${fixture.source}`, {
          code: "EVAL_FIXTURE_NOT_FOUND",
          cause: error,
        });
      }
      fixtureFingerprints.push(fingerprintFixture(source, rootPath));
      return { sourcePath: source, destinationPath: fixture.destination };
    });

    cases.push({
      id: document.id,
      name: document.name,
      prompt: document.prompt,
      partition,
      fixtures,
      assertions: document.assertions,
      sourcePath,
      contentHash: hashBytes(
        new TextEncoder().encode(JSON.stringify([hashBytes(bytes), fixtureFingerprints])),
      ),
    });
  }

  const partitions = new Set(cases.map((evalCase) => evalCase.partition));
  if (partitions.size !== 1) {
    const filesByPartition = cases
      .map((evalCase) => `${evalCase.sourcePath} (${evalCase.partition})`)
      .join(", ");
    throw new SkillbenchError(
      `Eval suite mixes development and holdout cases: ${filesByPartition}. Keep only one partition in each suite directory.`,
      { code: "EVAL_PARTITION_MIXED" },
    );
  }
  const partition = cases[0]!.partition;
  const identity = cases.map((evalCase) => [
    relative(rootPath, evalCase.sourcePath),
    evalCase.contentHash,
  ]);
  const id = hashBytes(new TextEncoder().encode(JSON.stringify([partition, identity])));
  return { id, partition, rootPath, cases };
}
