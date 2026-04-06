import { config as loadDotEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type XImageMode = "auto" | "kitty" | "off";

export interface AppConfig {
  xImageMode: XImageMode;
  dbPath?: string;
  screenTimeMaxSeconds?: number;
  screenTimeStatePath: string;
}

function parseImageMode(value: string | undefined): XImageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "kitty" || normalized === "off") return normalized;
  throw new Error(`Invalid X_IMAGE_MODE value "${value}". Expected: auto | kitty | off.`);
}

function parseMaxSeconds(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
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
  if (!confPath) return {};

  const raw = readFileSync(confPath, "utf8");
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
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
  const screenTimeMaxSeconds = parseMaxSeconds(fileConfig.MAX_SECONDS ?? process.env.MAX_SECONDS);

  return {
    xImageMode: parseImageMode(process.env.X_IMAGE_MODE),
    dbPath: process.env.TUITTER_DB_PATH?.trim() || undefined,
    screenTimeMaxSeconds,
    screenTimeStatePath: process.env.TUITTER_STATE_PATH?.trim() || join(process.cwd(), ".tuitter"),
  };
}
