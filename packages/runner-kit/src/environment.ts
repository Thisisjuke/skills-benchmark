export function selectEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  allowlist: readonly string[],
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of allowlist) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return { ...environment, ...overrides };
}
