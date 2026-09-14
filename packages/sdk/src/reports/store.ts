import { SkillbenchError } from "../errors";
import type { StoredReport } from "./types";

export interface ReportReader {
  get(id: string): StoredReport;
}

export interface ReportStore extends ReportReader {
  save(report: StoredReport): void;
}

export function createTransientReportStore(): ReportStore {
  const reports = new Map<string, StoredReport>();
  return {
    save: (report) => reports.set(report.id, structuredClone(report)),
    get: (id) => {
      const report = reports.get(id);
      if (report === undefined) {
        throw new SkillbenchError(`Report not found: ${id}`, { code: "REPORT_NOT_FOUND" });
      }
      return structuredClone(report);
    },
  };
}
