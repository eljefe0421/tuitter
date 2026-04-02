import type { AppConfig } from "../config.js";

export type QueryValue = string | number | boolean | undefined | null;
export type AccessTokenProvider = () => Promise<string>;

export interface XApiRateLimit {
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}

export interface XApiMeta {
  status: number;
  rateLimit: XApiRateLimit;
}

export interface XApiResponse<T> {
  data: T;
  meta: XApiMeta;
}

export interface XApiRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface XApiClientHooks {
  onUnauthorized?: () => Promise<void>;
}

export class XApiError extends Error {
  public readonly status: number;
  public readonly details: unknown;
  public readonly rateLimit: XApiRateLimit;

  public constructor(message: string, status: number, details: unknown, rateLimit: XApiRateLimit) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.details = details;
    this.rateLimit = rateLimit;
  }
}

function appendQuery(url: URL, query: Record<string, QueryValue> = {}): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function parseRateLimit(headers: Headers): XApiRateLimit {
  const limit = headers.get("x-rate-limit-limit");
  const remaining = headers.get("x-rate-limit-remaining");
  const reset = headers.get("x-rate-limit-reset");

  return {
    limit: limit ? Number(limit) : undefined,
    remaining: remaining ? Number(remaining) : undefined,
    resetAt: reset ? new Date(Number(reset) * 1000) : undefined,
  };
}

function extractApiErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.detail === "string" && record.detail.trim().length > 0) {
    return record.detail;
  }
  if (typeof record.title === "string" && record.title.trim().length > 0) {
    return record.title;
  }

  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const first = record.errors[0];
    if (first && typeof first === "object") {
      const firstRecord = first as Record<string, unknown>;
      if (typeof firstRecord.message === "string" && firstRecord.message.trim().length > 0) {
        return firstRecord.message;
      }
    }
  }

  return undefined;
}

export class XApiClient {
  private readonly config: AppConfig;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly hooks: XApiClientHooks;

  public constructor(config: AppConfig, getAccessToken: AccessTokenProvider, hooks: XApiClientHooks = {}) {
    this.config = config;
    this.getAccessToken = getAccessToken;
    this.hooks = hooks;
  }

  public async request<T>(path: string, options: XApiRequestOptions = {}): Promise<XApiResponse<T>> {
    const method = options.method ?? "GET";
    const normalizedPath = path.replace(/^\/+/, "");
    const url = new URL(
      normalizedPath,
      this.config.xApiBaseUrl.endsWith("/") ? this.config.xApiBaseUrl : `${this.config.xApiBaseUrl}/`,
    );
    appendQuery(url, options.query);

    const bodyString = options.body === undefined ? undefined : JSON.stringify(options.body);

    const send = async (accessToken: string): Promise<Response> =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: bodyString,
      });

    let response = await send(await this.getAccessToken());
    if (response.status === 401 && this.hooks.onUnauthorized) {
      await this.hooks.onUnauthorized();
      response = await send(await this.getAccessToken());
    }

    const rateLimit = parseRateLimit(response.headers);
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const detail = extractApiErrorDetail(payload);
      const message = detail
        ? `X API request failed (${response.status}): ${detail}`
        : `X API request failed (${response.status})`;
      throw new XApiError(message, response.status, payload, rateLimit);
    }

    return {
      data: payload as T,
      meta: {
        status: response.status,
        rateLimit,
      },
    };
  }

  public get<T>(path: string, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "GET", query });
  }

  public post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "POST", body, query });
  }

  public delete<T>(path: string, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "DELETE", query });
  }
}
