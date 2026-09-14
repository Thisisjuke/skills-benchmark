import type { ComparisonSummary } from "../comparator";
import type { SourceProviderId } from "../skills";

export type ReportSource = {
  name: string;
  origin: SourceProviderId;
  originalInput: string;
  rootPath: string;
  fingerprint: string;
  snapshotId: string;
  repository?: {
    owner: string;
    name: string;
    requestedRef: string;
    resolvedCommit: string;
  };
};

export type ComparisonReportPayloadV1 = {
  schemaVersion: 1;
  comparison: ComparisonSummary;
  sourceA: ReportSource;
  sourceB: ReportSource;
};

export type StoredReport = {
  id: string;
  runId: string;
  type: "comparison";
  title: string;
  markdown: string;
  payload: ComparisonReportPayloadV1;
  rendererVersion: string;
  createdAt: string;
};
