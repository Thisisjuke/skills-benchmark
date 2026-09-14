import { posix } from "node:path";

import { parse as parseYaml } from "yaml";
import * as z from "zod";

import { SkillbenchError, toErrorMessage } from "../errors";
import type { ParsedSkill, SkillFile } from "./types";

const frontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    license: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function decodeSkillMarkdown(file: SkillFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.content).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new SkillbenchError("SKILL.md must be valid UTF-8 text", {
      code: "SKILL_INVALID_ENCODING",
      cause: error,
    });
  }
}

function splitFrontmatter(source: string): { yaml: string; markdown: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new SkillbenchError("SKILL.md must start with YAML frontmatter delimited by ---", {
      code: "SKILL_FRONTMATTER_MISSING",
    });
  }
  return { yaml: match[1], markdown: match[2] };
}

function extractRelativeReferences(markdown: string): string[] {
  const references = new Set<string>();
  const linkPattern = /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;

  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1];
    if (target === undefined || /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
    const withoutSuffix = target.split(/[?#]/, 1)[0];
    if (withoutSuffix === undefined || withoutSuffix.length === 0) continue;
    const normalized = posix.normalize(decodeURIComponent(withoutSuffix));
    if (normalized !== ".." && !normalized.startsWith("../")) references.add(normalized);
  }

  return [...references].sort();
}

export function parseSkill(files: readonly SkillFile[]): ParsedSkill {
  const skillFiles = files.filter((file) => file.relativePath === "SKILL.md");
  if (skillFiles.length !== 1 || skillFiles[0] === undefined) {
    throw new SkillbenchError("The skill root must contain exactly one SKILL.md", {
      code: "SKILL_FILE_MISSING",
    });
  }

  const source = decodeSkillMarkdown(skillFiles[0]);
  const { yaml, markdown } = splitFrontmatter(source);

  try {
    const frontmatter = frontmatterSchema.parse(parseYaml(yaml));
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      ...(frontmatter.license === undefined ? {} : { license: frontmatter.license }),
      metadata: frontmatter.metadata ?? {},
      markdown,
      relativeReferences: extractRelativeReferences(markdown),
    };
  } catch (error) {
    throw new SkillbenchError(`Invalid SKILL.md frontmatter: ${toErrorMessage(error)}`, {
      code: "SKILL_FRONTMATTER_INVALID",
      cause: error,
    });
  }
}
