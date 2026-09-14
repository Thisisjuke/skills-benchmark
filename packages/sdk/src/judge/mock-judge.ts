import type { Judge, JudgeInput, JudgeResult } from "./judge";

export type MockJudgeHandler = (input: JudgeInput) => JudgeResult | Promise<JudgeResult>;

export class MockJudge implements Judge {
  constructor(private readonly handler: MockJudgeHandler) {}

  compare(input: JudgeInput): Promise<JudgeResult> {
    return Promise.resolve(this.handler(input));
  }
}
