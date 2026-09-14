import * as z from "zod";

const externalExecutionProfileSchema = z
  .object({
    runner: z.string().trim().min(1),
    runnerVersion: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
  })
  .catchall(z.json())
  .refine(({ runner }) => runner !== "mock", {
    message: "The built-in mock runner must use its dedicated execution profile",
    path: ["runner"],
  });

const mockExecutionProfileSchema = z
  .object({
    runner: z.literal("mock"),
    runnerVersion: z.literal("mock-v1"),
  })
  .strict();

export const executionProfileSchema = mockExecutionProfileSchema.or(externalExecutionProfileSchema);

export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export type MockExecutionProfile = z.infer<typeof mockExecutionProfileSchema>;

export const MOCK_EXECUTION_PROFILE: ExecutionProfile = Object.freeze({
  runner: "mock",
  runnerVersion: "mock-v1",
});

export function isMockExecutionProfile(
  profile: ExecutionProfile,
): profile is MockExecutionProfile {
  return mockExecutionProfileSchema.safeParse(profile).success;
}
