export type DebugMetadata = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, metadata?: DebugMetadata): void;
}

export type DebugLoggerOptions = {
  enabled: boolean;
  write?: (value: string) => void;
  redactions?: readonly string[];
};

const MAX_DEPTH = 4;
const MAX_ENTRIES = 50;
const MAX_STRING_LENGTH = 500;
const SENSITIVE_KEY =
  /authorization|api[-_]?key|token|secret|password|prompt|rubric|content|environment|holdout/iu;

export const SENSITIVE_ENVIRONMENT_KEYS = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const);

export const silentLogger: Logger = Object.freeze({
  debug: () => undefined,
});

export function createDebugLogger(options: DebugLoggerOptions): Logger {
  if (!options.enabled) return silentLogger;
  const write = options.write ?? ((value: string) => process.stderr.write(value));
  const redactions = (options.redactions ?? []).filter((value) => value.length > 0);
  return {
    debug(event, metadata = {}) {
      const record = sanitize({ event, ...metadata }, redactions, 0);
      write(`[debug] ${JSON.stringify(record)}\n`);
    },
  };
}

export function runtimeRedactions(environment: NodeJS.ProcessEnv = process.env): string[] {
  return SENSITIVE_ENVIRONMENT_KEYS.map((key) => environment[key]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function redactText(value: string, redactions: readonly string[]): string {
  return redactions
    .filter((redaction) => redaction.length > 0)
    .reduce((current, redaction) => current.replaceAll(redaction, "[redacted]"), value);
}

function sanitize(value: unknown, redactions: readonly string[], depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    const redacted = redactText(value, redactions);
    return redacted.length <= MAX_STRING_LENGTH
      ? redacted
      : `${redacted.slice(0, MAX_STRING_LENGTH)}[truncated]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return "[undefined]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((item) => sanitize(item, redactions, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, redactions, depth + 1),
        ]),
    );
  }
  return String(value);
}
