import type { Judge, JudgeCandidate, JudgeInput, JudgeResult } from "./judge";

export type BlindCandidate = Omit<JudgeCandidate, "label">;

export type BlindPairwiseInput = {
  rubric: string;
  prompt: string;
  candidateA: BlindCandidate;
  candidateB: BlindCandidate;
  redactions?: readonly string[];
  signal?: AbortSignal;
};

export type JudgePass =
  | { status: "completed"; mappedWinner: "A" | "B" | "tie"; result: JudgeResult }
  | { status: "failed" | "timed-out"; error: string };

export type BlindPairwiseResult = {
  winner: "A" | "B" | "tie";
  confidence: number;
  reasons: string[];
  forward: JudgePass;
  reverse: JudgePass;
};

export type BlindPairwiseOptions = {
  timeoutMs?: number;
  maxPayloadChars?: number;
};

export class BlindPairwiseJudge {
  private readonly timeoutMs: number;
  private readonly maxPayloadChars: number;

  constructor(
    private readonly judge: Judge,
    options: BlindPairwiseOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxPayloadChars = options.maxPayloadChars ?? 64 * 1024;
  }

  async compare(input: BlindPairwiseInput): Promise<BlindPairwiseResult> {
    const candidateA = sanitizeCandidate(input.candidateA, input.redactions ?? [], this.maxPayloadChars);
    const candidateB = sanitizeCandidate(input.candidateB, input.redactions ?? [], this.maxPayloadChars);
    const rubric = redact(bound(input.rubric, this.maxPayloadChars), input.redactions ?? []);
    const prompt = redact(bound(input.prompt, this.maxPayloadChars), input.redactions ?? []);
    const forwardInput: JudgeInput = {
      rubric,
      prompt,
      candidates: [
        { label: "X", ...candidateA },
        { label: "Y", ...candidateB },
      ],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const reverseInput: JudgeInput = {
      rubric,
      prompt,
      candidates: [
        { label: "X", ...candidateB },
        { label: "Y", ...candidateA },
      ],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const forward = await this.pass(forwardInput, { X: "A", Y: "B" });
    const reverse = await this.pass(reverseInput, { X: "B", Y: "A" });
    if (forward.status !== "completed" || reverse.status !== "completed") {
      return {
        winner: "tie",
        confidence: 0,
        reasons: ["At least one blind judge pass failed; deterministic scores remain authoritative."],
        forward,
        reverse,
      };
    }
    if (forward.mappedWinner !== reverse.mappedWinner) {
      return {
        winner: "tie",
        confidence: Math.min(0.25, forward.result.confidence, reverse.result.confidence),
        reasons: ["The X/Y and Y/X passes disagree, indicating position sensitivity."],
        forward,
        reverse,
      };
    }
    return {
      winner: forward.mappedWinner,
      confidence: (forward.result.confidence + reverse.result.confidence) / 2,
      reasons: [...forward.result.reasons, ...reverse.result.reasons],
      forward,
      reverse,
    };
  }

  private async pass(
    input: JudgeInput,
    mapping: Readonly<Record<"X" | "Y", "A" | "B">>,
  ): Promise<JudgePass> {
    try {
      const result = await withTimeout(this.judge.compare(input), this.timeoutMs, input.signal);
      validateResult(result);
      const bounded: JudgeResult = {
        ...result,
        reasons: result.reasons.map((reason) => bound(reason, this.maxPayloadChars)),
        ...(result.raw === undefined
          ? {}
          : { raw: bound(JSON.stringify(result.raw), this.maxPayloadChars) }),
      };
      return {
        status: "completed",
        mappedWinner: result.winner === "tie" ? "tie" : mapping[result.winner],
        result: bounded,
      };
    } catch (error) {
      if (input.signal?.aborted === true) throw error;
      return {
        status: error instanceof JudgeTimeoutError ? "timed-out" : "failed",
        error: bound(error instanceof Error ? error.message : String(error), this.maxPayloadChars),
      };
    }
  }
}

class JudgeTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new JudgeTimeoutError(`Judge timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return;
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  }
}

function sanitizeCandidate(
  candidate: BlindCandidate,
  redactions: readonly string[],
  maxChars: number,
): BlindCandidate {
  return {
    output: redact(bound(candidate.output, maxChars), redactions),
    artifacts: candidate.artifacts.map((artifact) => ({
      relativePath: redact(bound(artifact.relativePath, maxChars), redactions),
      content: redact(bound(artifact.content, maxChars), redactions),
    })),
  };
}

function redact(value: string, redactions: readonly string[]): string {
  return redactions
    .filter((item) => item !== "")
    .reduce((current, item) => current.split(item).join("[redacted]"), value);
}

function bound(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 11))}[truncated]`;
}

function validateResult(result: JudgeResult): void {
  if (!(["X", "Y", "tie"] as const).includes(result.winner)) {
    throw new Error(`Judge returned an invalid winner: ${String(result.winner)}`);
  }
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new Error(`Judge returned an invalid confidence: ${result.confidence}`);
  }
  if (!Array.isArray(result.reasons) || result.reasons.some((reason) => typeof reason !== "string")) {
    throw new Error("Judge returned invalid reasons");
  }
}
