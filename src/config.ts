import { config as loadDotEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  tokenStorePath: string;
}

export interface AppConfig {
  xApiBaseUrl: string;
  oauth: OAuthConfig;
  timelinePageSize: number;
  xImageMode: XImageMode;
  screenTimeMaxSeconds?: number;
  screenTimeStatePath: string;
}

export type XImageMode = "auto" | "kitty" | "off";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and set OAuth values.`,
    );
  }
  return value;
}

function parseImageMode(value: string | undefined): XImageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return "auto";
  }
  if (normalized === "kitty" || normalized === "off") {
    return normalized;
  }
  throw new Error(`Invalid X_IMAGE_MODE value "${value}". Expected: auto | kitty | off.`);
}

function parseMaxSeconds(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid MAX_SECONDS value "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function readTuitterConf(): Record<string, string> {
  const candidatePaths = [
    join(process.cwd(), "tuitter.conf"),
    join(homedir(), ".tuitter", "tuitter.conf"),
  ];
  let confPath: string | undefined;
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      confPath = candidate;
      break;
    }
  }
  if (!confPath) {
    return {};
  }

  const raw = readFileSync(confPath, "utf8");
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      throw new Error(`Invalid line in tuitter.conf: "${line}"`);
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

export function loadConfig(): AppConfig {
  loadDotEnv({ quiet: true });
  const fileConfig = readTuitterConf();
  const rawScopes = process.env.X_OAUTH_SCOPES?.trim();
  const screenTimeMaxSeconds = parseMaxSeconds(fileConfig.MAX_SECONDS ?? process.env.MAX_SECONDS);

  return {
    xApiBaseUrl: "https://api.x.com/2",
    timelinePageSize: 20,
    xImageMode: parseImageMode(process.env.X_IMAGE_MODE),
    screenTimeMaxSeconds,
    screenTimeStatePath: process.env.TUITTER_STATE_PATH?.trim() || join(process.cwd(), ".tuitter"),
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
      tokenStorePath:
        process.env.X_TOKEN_STORE_PATH?.trim() || join(homedir(), ".tuitter", "oauth-token.json"),
    },
  };
}
