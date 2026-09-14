// Registered by the SDK comparison scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { BlindPairwiseJudge, MockJudge, type JudgeInput } from "@skillbench/sdk/judge";

const baseInput = {
  rubric: "Prefer the clearer answer for SECRET_SKILL.",
  prompt: "Help with SECRET_FINGERPRINT.",
  candidateA: { output: "good SECRET_SKILL", artifacts: [] },
  candidateB: { output: "bad SECRET_FINGERPRINT", artifacts: [] },
  redactions: ["SECRET_SKILL", "SECRET_FINGERPRINT"],
};

describe("BlindPairwiseJudge", () => {
  it("maps an agreeing content-based judge through X/Y and Y/X", async () => {
    const calls: JudgeInput[] = [];
    const judge = new MockJudge((input) => {
      calls.push(input);
      const winner = input.candidates[0].output.startsWith("good") ? "X" : "Y";
      return { winner, confidence: 0.8, reasons: ["clearer"] };
    });
    const result = await new BlindPairwiseJudge(judge).compare(baseInput);

    expect(result).toMatchObject({ winner: "A", confidence: 0.8 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.candidates.map((candidate) => candidate.label)).toEqual(["X", "Y"]);
    expect(calls[1]?.candidates.map((candidate) => candidate.label)).toEqual(["X", "Y"]);
    expect(JSON.stringify(calls)).not.toContain("SECRET_SKILL");
    expect(JSON.stringify(calls)).not.toContain("SECRET_FINGERPRINT");
  });

  it("turns position-sensitive disagreement into a low-confidence tie", async () => {
    const judge = new MockJudge(() => ({ winner: "X", confidence: 0.9, reasons: ["first"] }));
    const result = await new BlindPairwiseJudge(judge).compare(baseInput);
    expect(result.winner).toBe("tie");
    expect(result.confidence).toBeLessThanOrEqual(0.25);
    expect(result.reasons[0]).toContain("position sensitivity");
  });

  it("contains invalid results, thrown errors and timeouts without a winner", async () => {
    const invalid = new MockJudge(() => ({ winner: "X", confidence: 2, reasons: [] }));
    const invalidResult = await new BlindPairwiseJudge(invalid).compare(baseInput);
    expect(invalidResult).toMatchObject({ winner: "tie", confidence: 0 });
    expect(invalidResult.forward.status).toBe("failed");

    const failing = new MockJudge(() => {
      throw new Error("judge unavailable");
    });
    expect((await new BlindPairwiseJudge(failing).compare(baseInput)).winner).toBe("tie");

    const hanging = new MockJudge(() => new Promise(() => undefined));
    const timedOut = await new BlindPairwiseJudge(hanging, { timeoutMs: 10 }).compare(baseInput);
    expect(timedOut).toMatchObject({ winner: "tie", confidence: 0 });
    expect(timedOut.forward.status).toBe("timed-out");
    expect(timedOut.reverse.status).toBe("timed-out");
  });

  it("bounds raw judge payloads", async () => {
    const judge = new MockJudge(() => ({
      winner: "tie",
      confidence: 1,
      reasons: ["x".repeat(1_000)],
      raw: { payload: "y".repeat(1_000) },
    }));
    const result = await new BlindPairwiseJudge(judge, { maxPayloadChars: 80 }).compare(baseInput);
    expect(result.forward.status).toBe("completed");
    if (result.forward.status === "completed") {
      expect(result.forward.result.reasons[0]?.length).toBeLessThanOrEqual(80);
      expect(String(result.forward.result.raw).length).toBeLessThanOrEqual(80);
    }
  });

  it("propagates cancellation instead of degrading it to a tie", async () => {
    const controller = new AbortController();
    const hanging = new MockJudge(() => new Promise(() => undefined));
    const comparison = new BlindPairwiseJudge(hanging, { timeoutMs: 10_000 }).compare({
      ...baseInput,
      signal: controller.signal,
    });

    controller.abort(new Error("cancelled by test"));

    await expect(comparison).rejects.toThrow("cancelled by test");
  });
});
