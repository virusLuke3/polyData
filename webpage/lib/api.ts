import "server-only";

import type { DashboardResponse, MarketDetailResponse, MarketListResponse, SearchResponse } from "@/types";

import { logError, logInfo } from "@/lib/logger";

function getApiBaseUrl() {
  return process.env.POLYDATA_API_BASE_URL || process.env.NEXT_PUBLIC_POLYDATA_API_BASE_URL || "http://127.0.0.1:5000";
}

async function fetchJson<T>(path: string, options?: { cacheMode?: RequestCache; revalidate?: number }): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const startedAt = Date.now();

  try {
    logInfo("api", "request started", { method: "GET", path, url });

    const response = await fetch(url, options?.revalidate ? { next: { revalidate: options.revalidate } } : { cache: options?.cacheMode ?? "no-store" });

    const durationMs = Date.now() - startedAt;
    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
      const responseText = await response.text();
      logError("api", "request failed", undefined, {
        method: "GET",
        path,
        url,
        status: response.status,
        durationMs,
        requestId,
        responseSnippet: responseText.slice(0, 500)
      });
      throw new Error(`API request failed: ${response.status} ${path}${requestId ? ` requestId=${requestId}` : ""}`);
    }

    logInfo("api", "request completed", {
      method: "GET",
      path,
      url,
      status: response.status,
      durationMs,
      requestId
    });

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Dynamic server usage:")) {
      logInfo("api", "dynamic render marker", {
        method: "GET",
        path,
        url,
        durationMs: Date.now() - startedAt,
        reason: error.message
      });
      throw error;
    }

    if (error instanceof Error && error.message.startsWith("API request failed:")) {
      throw error;
    }

    logError("api", "request threw", error, {
      method: "GET",
      path,
      url,
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

export async function getDashboardData() {
  return fetchJson<DashboardResponse>("/dashboard", { cacheMode: "no-store" });
}

export async function getMarkets(params: { status?: string; page?: number; q?: string }) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.page) search.set("page", String(params.page));
  if (params.q) search.set("q", params.q);
  search.set("pageSize", "20");
  return fetchJson<MarketListResponse>(`/markets?${search.toString()}`, { revalidate: 30 });
}

export async function getMarketDetail(id: string) {
  return fetchJson<MarketDetailResponse>(`/markets/${id}/detail`, { revalidate: 30 });
}

export async function searchMarkets(query: string) {
  if (!query) {
    return { items: [] } satisfies SearchResponse;
  }
  const search = new URLSearchParams({ q: query });
  return fetchJson<SearchResponse>(`/search?${search.toString()}`, { cacheMode: "no-store" });
}