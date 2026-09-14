import {
  SKILLBENCH_PROTOCOL_VERSION,
  skillbenchEventSchema,
  type SkillbenchCommand,
  type SkillbenchEvent,
  type SkillbenchProtocolError,
} from "@skillbench/invocation-contract";

export class CliJsonlWriter {
  constructor(
    private readonly command: SkillbenchCommand,
    private readonly jobId: string,
    private readonly write: (value: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  started(): void {
    this.emit("started", {});
  }

  phase(name: string): void {
    this.emit("phase", { name });
  }

  progress(message: string, current?: number, total?: number): void {
    this.emit("progress", {
      message,
      ...(current === undefined ? {} : { current }),
      ...(total === undefined ? {} : { total }),
    });
  }

  artifact(kind: "bundle" | "report" | "skill" | "workspace", path: string): void {
    this.emit("artifact", { kind, path });
  }

  completed(result: unknown): void {
    this.emit("completed", { result });
  }

  failed(error: SkillbenchProtocolError): void {
    this.emit("failed", { error });
  }

  cancelled(reason?: string): void {
    this.emit("cancelled", reason === undefined ? {} : { reason });
  }

  private emit(event: SkillbenchEvent["event"], data: unknown): void {
    const value = skillbenchEventSchema.parse({
      schemaVersion: SKILLBENCH_PROTOCOL_VERSION,
      event,
      command: this.command,
      jobId: this.jobId,
      timestamp: this.now().toISOString(),
      data,
    });
    this.write(`${JSON.stringify(value)}\n`);
  }
}
