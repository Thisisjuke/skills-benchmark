export function appendBounded(existing: string, addition: string, maxBytes: number): string {
  if (addition === "") return existing;
  const joined = existing === "" ? addition : `${existing.replace(/\s+$/u, "")}\n${addition}`;
  const encoded = new TextEncoder().encode(joined);
  return encoded.byteLength <= maxBytes
    ? joined
    : new TextDecoder().decode(encoded.subarray(0, maxBytes));
}
