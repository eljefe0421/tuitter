export class XApiError extends Error {
    status;
    details;
    rateLimit;
    constructor(message, status, details, rateLimit) {
        super(message);
        this.name = "XApiError";
        this.status = status;
        this.details = details;
        this.rateLimit = rateLimit;
    }
}
function appendQuery(url, query = {}) {
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) {
            continue;
        }
        url.searchParams.set(key, String(value));
    }
}
function parseRateLimit(headers) {
    const limit = headers.get("x-rate-limit-limit");
    const remaining = headers.get("x-rate-limit-remaining");
    const reset = headers.get("x-rate-limit-reset");
    return {
        limit: limit ? Number(limit) : undefined,
        remaining: remaining ? Number(remaining) : undefined,
        resetAt: reset ? new Date(Number(reset) * 1000) : undefined,
    };
}
function extractApiErrorDetail(payload) {
    if (!payload || typeof payload !== "object") {
        return undefined;
    }
    const record = payload;
    if (typeof record.detail === "string" && record.detail.trim().length > 0) {
        return record.detail;
    }
    if (typeof record.title === "string" && record.title.trim().length > 0) {
        return record.title;
    }
    if (Array.isArray(record.errors) && record.errors.length > 0) {
        const first = record.errors[0];
        if (first && typeof first === "object") {
            const firstRecord = first;
            if (typeof firstRecord.message === "string" && firstRecord.message.trim().length > 0) {
                return firstRecord.message;
            }
        }
    }
    return undefined;
}
export class XApiClient {
    config;
    getAccessToken;
    hooks;
    constructor(config, getAccessToken, hooks = {}) {
        this.config = config;
        this.getAccessToken = getAccessToken;
        this.hooks = hooks;
    }
    async request(path, options = {}) {
        const method = options.method ?? "GET";
        const normalizedPath = path.replace(/^\/+/, "");
        const url = new URL(normalizedPath, this.config.xApiBaseUrl.endsWith("/") ? this.config.xApiBaseUrl : `${this.config.xApiBaseUrl}/`);
        appendQuery(url, options.query);
        const bodyString = options.body === undefined ? undefined : JSON.stringify(options.body);
        const send = async (accessToken) => fetch(url, {
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
            data: payload,
            meta: {
                status: response.status,
                rateLimit,
            },
        };
    }
    get(path, query) {
        return this.request(path, { method: "GET", query });
    }
    post(path, body, query) {
        return this.request(path, { method: "POST", body, query });
    }
    delete(path, query) {
        return this.request(path, { method: "DELETE", query });
    }
}
