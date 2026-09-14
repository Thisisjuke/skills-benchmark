export {
  COMPARISON_RENDERER_VERSION,
  renderComparisonReport,
} from "./comparison-renderer";
export {
  ComparisonReportService,
  type ReportRenderer,
  type ReportServiceOptions,
} from "./service";
export {
  createTransientReportStore,
  type ReportReader,
  type ReportStore,
} from "./store";
export type { ComparisonReportPayloadV1, ReportSource, StoredReport } from "./types";
