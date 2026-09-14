import { describe, expect, it } from "vite-plus/test";

import { appendBounded, CachedVersionProbe, selectEnvironment } from "../src";

describe("runner kit", () => {
  it("selects only allowed environment values before applying explicit overrides", () => {
    expect(
      selectEnvironment({ ALLOWED: "yes", SECRET: "no" }, ["ALLOWED"], { NO_COLOR: "1" }),
    ).toEqual({ ALLOWED: "yes", NO_COLOR: "1" });
  });

  it("bounds appended output by encoded bytes", () => {
    expect(appendBounded("a", "éé", 4)).toBe("a\né");
  });

  it("loads an executable version once", async () => {
    let calls = 0;
    const probe = new CachedVersionProbe(async () => {
      calls += 1;
      return "1.0.0";
    });
    await expect(Promise.all([probe.get(), probe.get()])).resolves.toEqual(["1.0.0", "1.0.0"]);
    expect(calls).toBe(1);
  });
});
