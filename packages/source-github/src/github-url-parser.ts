import { posix } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import type { GitHubSourceDescriptor, GitHubSourceLocation } from "./github-types";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]+(?:\.git)?$/;

function invalid(message: string): never {
  throw new SkillbenchError(`Invalid GitHub skill source: ${message}`, {
    code: "GITHUB_SOURCE_INVALID",
  });
}

function decodeSegment(segment: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return invalid(`${label} contains invalid URL encoding`);
  }
  if (decoded.length === 0 || decoded === "." || decoded === ".." || /[\\\0/]/.test(decoded)) {
    return invalid(`${label} contains an unsafe path segment`);
  }
  return decoded;
}

function repositoryName(value: string): string {
  return value.replace(/\.git$/i, "");
}

function validateRepository(owner: string, repository: string): void {
  if (!OWNER_PATTERN.test(owner)) invalid("owner is missing or malformed");
  if (!REPOSITORY_PATTERN.test(repository) || repository === "." || repository === "..") {
    invalid("repository is missing or malformed");
  }
}

function normalizeRef(ref: string): string {
  const value = ref.trim();
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    /[\\\0]/.test(value)
  ) {
    return invalid("ref is missing or malformed");
  }
  return value;
}

function normalizePath(
  pathSegments: string[],
  pathPointsToSkillFile: boolean,
): {
  skillRoot: string;
  skillPath: string;
} {
  const decodedPath = pathSegments.map((segment, index) =>
    decodeSegment(segment, `path segment ${index + 1}`),
  );
  if (pathPointsToSkillFile) {
    if (decodedPath.at(-1) !== "SKILL.md") invalid("URL path must end with SKILL.md");
    decodedPath.pop();
  } else if (decodedPath.at(-1) === "SKILL.md") {
    decodedPath.pop();
  }
  const skillRoot = decodedPath.length === 0 ? "." : posix.join(...decodedPath);
  return {
    skillRoot,
    skillPath: skillRoot === "." ? "SKILL.md" : `${skillRoot}/SKILL.md`,
  };
}

function descriptor(
  owner: string,
  repository: string,
  sourceLocation: GitHubSourceLocation,
  options: { alternatives?: GitHubSourceLocation[]; defaultBranch?: boolean } = {},
): GitHubSourceDescriptor {
  validateRepository(owner, repository);
  return {
    owner,
    repository,
    ...sourceLocation,
    ...(options.defaultBranch === true ? { defaultBranch: true } : {}),
    ...(options.alternatives === undefined || options.alternatives.length === 0
      ? {}
      : { alternatives: options.alternatives }),
  };
}

function location(
  requestedRef: string,
  pathSegments: string[],
  pathPointsToSkillFile: boolean,
  discover: boolean,
): GitHubSourceLocation {
  return {
    requestedRef: normalizeRef(requestedRef),
    ...normalizePath(pathSegments, pathPointsToSkillFile),
    ...(discover ? { discover: true } : {}),
  };
}

function ambiguousLocations(
  tail: string[],
  pathPointsToSkillFile: boolean,
  discover: boolean,
): GitHubSourceLocation[] {
  const lastRefSegment = pathPointsToSkillFile ? tail.length - 1 : tail.length;
  if (lastRefSegment < 1) invalid("URL is missing a ref");
  const locations: GitHubSourceLocation[] = [];
  for (let split = 1; split <= lastRefSegment; split += 1) {
    const ref = tail
      .slice(0, split)
      .map((segment, index) => decodeSegment(segment, `ref segment ${index + 1}`))
      .join("/");
    locations.push(location(ref, tail.slice(split), pathPointsToSkillFile, discover));
  }
  return locations;
}

function defaultDescriptor(
  owner: string,
  repository: string,
  pathSegments: string[] = [],
): GitHubSourceDescriptor {
  return descriptor(owner, repository, location("HEAD", pathSegments, false, true), {
    defaultBranch: true,
  });
}

function parseGitHubUrl(input: string): GitHubSourceDescriptor {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalid("URL cannot be parsed");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return invalid("only plain HTTPS GitHub URLs are supported");
  }

  const encodedSegments = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "github.com") {
    if (encodedSegments.length < 2) invalid("URL must contain owner/repository");
    const owner = decodeSegment(encodedSegments[0]!, "owner");
    const repository = repositoryName(decodeSegment(encodedSegments[1]!, "repository"));
    if (encodedSegments.length === 2) return defaultDescriptor(owner, repository);
    const view = encodedSegments[2];
    if ((view !== "tree" && view !== "blob") || encodedSegments.length < 4) {
      return invalid("github.com URL must target a repository, tree, or SKILL.md blob");
    }
    const locations = ambiguousLocations(
      encodedSegments.slice(3),
      view === "blob",
      view === "tree",
    );
    return descriptor(owner, repository, locations[0]!, { alternatives: locations.slice(1) });
  }

  if (url.hostname === "raw.githubusercontent.com") {
    if (encodedSegments.length < 4) {
      return invalid("raw URL must use /owner/repository/ref/path/to/SKILL.md");
    }
    const owner = decodeSegment(encodedSegments[0]!, "owner");
    const repository = repositoryName(decodeSegment(encodedSegments[1]!, "repository"));
    const locations = ambiguousLocations(encodedSegments.slice(2), true, false);
    return descriptor(owner, repository, locations[0]!, { alternatives: locations.slice(1) });
  }

  return invalid("host must be github.com or raw.githubusercontent.com");
}

function parseShorthand(input: string): GitHubSourceDescriptor {
  const body = input.slice("github:".length);
  const separator = body.lastIndexOf("@");
  const locationText = separator === -1 ? body : body.slice(0, separator);
  const segments = locationText.split("/");
  if (segments.length < 2) invalid("shorthand must contain owner/repository");
  const owner = decodeSegment(segments[0]!, "owner");
  const repository = repositoryName(decodeSegment(segments[1]!, "repository"));
  if (separator === -1) return defaultDescriptor(owner, repository, segments.slice(2));
  if (separator === 0 || separator === body.length - 1) invalid("shorthand has a malformed @ref");
  return descriptor(
    owner,
    repository,
    location(body.slice(separator + 1), segments.slice(2), false, true),
  );
}

function parseSlug(input: string): GitHubSourceDescriptor {
  const [owner, repository] = input.split("/");
  return defaultDescriptor(owner!, repositoryName(repository!));
}

export function supportsGitHubSource(input: string): boolean {
  if (input.startsWith("github:")) return true;
  if (SLUG_PATTERN.test(input)) return true;
  try {
    const url = new URL(input);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "raw.githubusercontent.com")
    );
  } catch {
    return false;
  }
}

export function parseGitHubSource(input: string): GitHubSourceDescriptor {
  if (input.startsWith("github:")) return parseShorthand(input);
  return SLUG_PATTERN.test(input) ? parseSlug(input) : parseGitHubUrl(input);
}
