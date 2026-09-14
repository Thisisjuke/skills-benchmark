import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { SkillbenchError, toErrorMessage } from "../errors";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  hashBytes,
  parseSkill,
  type ResolvedSkill,
  type SkillFile,
} from "../skills";
import type { ResolveOptions, SkillSourceResolver } from "./source";

const IGNORED_DIRECTORIES = new Set([".git", ".skillbench", "node_modules"]);

export type LocalSourcePolicy = {
  maxFileSizeBytes: number;
  maxSnapshotSizeBytes: number;
};

export type LocalSourceResolverOptions = {
  baseDirectory?: string;
};

export class LocalSourceResolver implements SkillSourceResolver {
  readonly capabilities = Object.freeze({ provider: "local", locality: "local" } as const);
  private readonly baseDirectory: string;

  constructor(
    private readonly policy: LocalSourcePolicy,
    options: LocalSourceResolverOptions = {},
  ) {
    this.baseDirectory = resolve(options.baseDirectory ?? process.cwd());
  }

  supports(input: string): boolean {
    return !/^(?:https?:\/\/|github:)/i.test(input);
  }

  async resolve(input: string, options: ResolveOptions = {}): Promise<ResolvedSkill> {
    const originalInput = input;
    const inputPath = resolve(this.baseDirectory, input);
    let inputStats;
    try {
      inputStats = await lstat(inputPath);
    } catch (error) {
      throw new SkillbenchError(`Local skill source not found: ${inputPath}`, {
        code: "LOCAL_SOURCE_NOT_FOUND",
        cause: error,
      });
    }

    if (inputStats.isSymbolicLink()) {
      throw new SkillbenchError(`Symbolic links are not supported as skill roots: ${inputPath}`, {
        code: "LOCAL_SOURCE_SYMLINK",
      });
    }

    let rootPath: string;
    if (inputStats.isDirectory()) {
      rootPath = inputPath;
    } else if (inputStats.isFile() && basename(inputPath) === "SKILL.md") {
      rootPath = dirname(inputPath);
    } else {
      throw new SkillbenchError(
        `Local skill source must be a directory or a SKILL.md file: ${inputPath}`,
        {
          code: "LOCAL_SOURCE_INVALID",
        },
      );
    }

    const files = await this.readTree(rootPath);
    const skill = parseSkill(files);
    const fingerprint = fingerprintFiles(files);
    const fetchedAt = (options.now ?? new Date()).toISOString();

    return {
      snapshot: {
        id: crypto.randomUUID(),
        origin: { type: "local", originalInput },
        rootPath,
        files,
        fingerprint,
        fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
        fetchedAt,
      },
      skill,
    };
  }

  private async readTree(rootPath: string): Promise<SkillFile[]> {
    const files: SkillFile[] = [];
    let snapshotSize = 0;

    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const absolutePath = resolve(directory, entry.name);
        const relativePath =
          relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;

        if (entry.isSymbolicLink()) {
          throw new SkillbenchError(
            `Symbolic links are not supported in skill snapshots: ${relativePath}`,
            {
              code: "LOCAL_SOURCE_SYMLINK",
            },
          );
        }
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
          continue;
        }
        if (!entry.isFile()) continue;

        let content: Uint8Array;
        try {
          content = new Uint8Array(await readFile(absolutePath));
        } catch (error) {
          throw new SkillbenchError(
            `Cannot read skill file ${relativePath}: ${toErrorMessage(error)}`,
            {
              code: "LOCAL_SOURCE_READ_FAILED",
              cause: error,
            },
          );
        }
        if (content.byteLength > this.policy.maxFileSizeBytes) {
          throw new SkillbenchError(
            `Skill file exceeds maxFileSizeBytes (${this.policy.maxFileSizeBytes}): ${relativePath}`,
            { code: "LOCAL_SOURCE_FILE_TOO_LARGE" },
          );
        }
        snapshotSize += content.byteLength;
        if (snapshotSize > this.policy.maxSnapshotSizeBytes) {
          throw new SkillbenchError(
            `Skill snapshot exceeds maxSnapshotSizeBytes (${this.policy.maxSnapshotSizeBytes})`,
            { code: "LOCAL_SOURCE_TOO_LARGE" },
          );
        }
        files.push({
          relativePath,
          content,
          contentHash: hashBytes(content),
          sizeBytes: content.byteLength,
        });
      }
    };

    await visit(rootPath, "");
    return files;
  }
}
