// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { App } from "../src/client/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Skillbench Web client", () => {
  it("renders through the production provider graph and changes command fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        return Response.json(path.endsWith("/api/jobs") ? { jobs: [] } : { sources: [] });
      }),
    );
    vi.stubGlobal("EventSource", class {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Skillbench" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "compare" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByLabelText("Source B")).toBeTruthy();
    expect((screen.getByLabelText("Suite d’évaluation") as HTMLInputElement).value).toBe(
      ".skillbench/evals/development/default.yaml",
    );

    await userEvent.click(screen.getByRole("tab", { name: "inspect" }));
    expect(screen.queryByLabelText("Source B")).toBeNull();
    expect(screen.queryByLabelText("Suite d’évaluation")).toBeNull();
    await waitFor(() => expect(screen.getByText("Aucun job pour le moment.")).toBeTruthy());

    queryClient.clear();
  });
});
