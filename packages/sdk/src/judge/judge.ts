export type JudgeCandidate = {
  label: "X" | "Y";
  output: string;
  artifacts: readonly {
    relativePath: string;
    content: string;
  }[];
};

export type JudgeInput = {
  rubric: string;
  prompt: string;
  candidates: readonly [JudgeCandidate, JudgeCandidate];
  signal?: AbortSignal;
};

export type JudgeResult = {
  winner: "X" | "Y" | "tie";
  confidence: number;
  reasons: readonly string[];
  raw?: unknown;
};

export interface Judge {
  compare(input: JudgeInput): Promise<JudgeResult>;
}
