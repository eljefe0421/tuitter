import { config as loadDotEnv } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";
function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and set OAuth values.`);
    }
    return value;
}
function parseImageMode(value) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized === "auto") {
        return "auto";
    }
    if (normalized === "kitty" || normalized === "off") {
        return normalized;
    }
    throw new Error(`Invalid X_IMAGE_MODE value "${value}". Expected: auto | kitty | off.`);
}
export function loadConfig() {
    loadDotEnv();
    const rawScopes = process.env.X_OAUTH_SCOPES?.trim();
    return {
        xApiBaseUrl: "https://api.x.com/2",
        timelinePageSize: 20,
        xImageMode: parseImageMode(process.env.X_IMAGE_MODE),
        oauth: {
            clientId: requiredEnv("X_CLIENT_ID"),
            clientSecret: process.env.X_CLIENT_SECRET?.trim() || undefined,
            redirectUri: process.env.X_REDIRECT_URI?.trim() || "http://127.0.0.1:8787/callback",
            scopes: rawScopes
                ? rawScopes.split(/\s+/).filter(Boolean)
                : [
                    "tweet.read",
                    "users.read",
                    "tweet.write",
                    "like.write",
                    "like.read",
                    "bookmark.write",
                    "bookmark.read",
                    "offline.access",
                ],
            authorizeUrl: "https://x.com/i/oauth2/authorize",
            tokenUrl: "https://api.x.com/2/oauth2/token",
            tokenStorePath: process.env.X_TOKEN_STORE_PATH?.trim() || join(homedir(), ".tuitter", "oauth-token.json"),
        },
    };
}
