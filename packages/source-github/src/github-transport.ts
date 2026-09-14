import { request as octokitRequest } from "@octokit/request";

import { SkillbenchError, toErrorMessage } from "@skillbench/sdk/errors";
import { silentLogger, type Logger } from "@skillbench/sdk/logging";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GitHubTransportOptions = {
  fetcher?: FetchLike;
  token?: string;
  timeoutMs?: number;
  apiBaseUrl?: string;
  rawBaseUrl?: string;
  logger?: Logger;
};

export class GitHubTransport {
  private readonly timeoutMs: number;
  private readonly apiBaseUrl: string;
  private readonly rawBaseUrl: string;
  private readonly logger: Logger;
  private readonly authenticated: boolean;
  private readonly apiRequest: typeof octokitRequest;
  private readonly rawRequest: typeof octokitRequest;

  constructor(options: GitHubTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.rawBaseUrl = (options.rawBaseUrl ?? "https://raw.githubusercontent.com").replace(
      /\/$/,
      "",
    );
    this.logger = options.logger ?? silentLogger;
    this.authenticated = options.token !== undefined;
    const customFetch =
      options.fetcher ??
      ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
    this.apiRequest = octokitRequest.defaults({
      baseUrl: this.apiBaseUrl,
      headers: {
        "user-agent": "skillbench",
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      },
      request: { fetch: customFetch },
    });
    this.rawRequest = octokitRequest.defaults({
      headers: { "user-agent": "skillbench" },
      request: { fetch: customFetch },
    });
  }

  apiUrl(path: string): string {
    return `${this.apiBaseUrl}${path}`;
  }

  rawUrl(path: string): string {
    return `${this.rawBaseUrl}${path}`;
  }

  async requestJson<T>(url: string): Promise<T> {
    const data = await this.requestData<unknown>(url, true);
    if (typeof data !== "object" || data === null) {
      throw new SkillbenchError(`GitHub returned invalid JSON for ${url}`, {
        code: "GITHUB_RESPONSE_INVALID",
      });
    }
    return data as T;
  }

  async requestBytes(url: string, apiRequest: boolean): Promise<Uint8Array> {
    const data = await this.requestData<unknown>(url, apiRequest);
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new SkillbenchError(`GitHub returned an unsupported file body for ${url}`, {
      code: "GITHUB_RESPONSE_INVALID",
    });
  }

  private async requestData<T>(url: string, apiRequest: boolean): Promise<T> {
    const startedAt = performance.now();
    const parsedUrl = new URL(url);
    this.logger.debug("github.request.start", {
      host: parsedUrl.hostname,
      path: parsedUrl.pathname,
      apiRequest,
      authenticated: apiRequest && this.authenticated,
      timeoutMs: this.timeoutMs,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (apiRequest ? this.apiRequest : this.rawRequest)<T>({
        method: "GET",
        url,
        request: { signal: controller.signal },
      });
      this.logger.debug("github.request.complete", {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
        apiRequest,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        sizeBytes: bodySize(response.data),
      });
      return response.data;
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const status = requestStatus(error);
      const remaining = requestHeader(error, "x-ratelimit-remaining");
      const missingCommit = status === 422 && parsedUrl.pathname.includes("/commits/");
      const code =
        status === 404 || missingCommit
          ? "GITHUB_NOT_FOUND"
          : status === 403 && remaining === "0"
            ? "GITHUB_RATE_LIMITED"
            : status === undefined
              ? timedOut
                ? "GITHUB_TIMEOUT"
                : "GITHUB_NETWORK_ERROR"
              : "GITHUB_HTTP_ERROR";
      this.logger.debug("github.request.failed", {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
        apiRequest,
        timedOut,
        status,
        durationMs: Math.round(performance.now() - startedAt),
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      throw new SkillbenchError(
        timedOut
          ? `GitHub request timed out after ${this.timeoutMs}ms`
          : status === undefined
            ? `GitHub request failed: ${toErrorMessage(error)}`
            : `GitHub request failed with HTTP ${status}: ${url}`,
        { code, cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function requestStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function requestHeader(error: unknown, name: string): string | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
  const response = error.response;
  if (typeof response !== "object" || response === null || !("headers" in response)) {
    return undefined;
  }
  const headers = response.headers;
  if (typeof headers !== "object" || headers === null) return undefined;
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function bodySize(data: unknown): number | undefined {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return undefined;
}
