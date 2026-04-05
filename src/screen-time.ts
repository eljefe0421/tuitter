import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface ScreenTimeState {
  date: string;
  secondsToday: number;
}

interface PersistedScreenTimeState {
  date?: unknown;
  secondsToday?: unknown;
}

export interface ScreenTimeSnapshot {
  secondsToday: number;
  maxSeconds?: number;
  exceeded: boolean;
}

export class ScreenTimeTracker {
  private readonly configuredStatePath: string;
  private readonly maxSeconds?: number;
  private resolvedStatePath: string;
  private state: ScreenTimeState = {
    date: ScreenTimeTracker.todayKey(),
    secondsToday: 0,
  };
  private sessionStartMs = Date.now();

  public constructor(statePath: string, maxSeconds?: number) {
    this.configuredStatePath = statePath;
    this.resolvedStatePath = statePath;
    this.maxSeconds = maxSeconds;
  }

  public async initialize(): Promise<void> {
    this.resolvedStatePath = await this.resolveStatePath(this.configuredStatePath);
    await this.loadState();
    this.sessionStartMs = Date.now();
  }

  public snapshot(nowMs = Date.now()): ScreenTimeSnapshot {
    this.ensureCurrentDay(nowMs);
    const elapsedSeconds = this.elapsedSessionSeconds(nowMs);
    const secondsToday = this.state.secondsToday + elapsedSeconds;
    const exceeded = this.maxSeconds !== undefined && secondsToday >= this.maxSeconds;
    return {
      secondsToday,
      maxSeconds: this.maxSeconds,
      exceeded,
    };
  }

  public async checkpoint(nowMs = Date.now()): Promise<void> {
    this.ensureCurrentDay(nowMs);
    this.state.secondsToday += this.elapsedSessionSeconds(nowMs);
    this.sessionStartMs = nowMs;
    await this.persistState();
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.resolvedStatePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedScreenTimeState;
      const today = ScreenTimeTracker.todayKey();
      if (parsed.date === today && typeof parsed.secondsToday === "number" && parsed.secondsToday >= 0) {
        this.state = {
          date: today,
          secondsToday: Math.floor(parsed.secondsToday),
        };
      } else {
        this.state = {
          date: today,
          secondsToday: 0,
        };
      }
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code !== "ENOENT") {
        throw error;
      }
      this.state = {
        date: ScreenTimeTracker.todayKey(),
        secondsToday: 0,
      };
      await this.persistState();
    }
  }

  private async persistState(): Promise<void> {
    await mkdir(dirname(this.resolvedStatePath), { recursive: true });
    await writeFile(this.resolvedStatePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  private ensureCurrentDay(nowMs: number): void {
    const today = ScreenTimeTracker.todayKey(nowMs);
    if (this.state.date === today) {
      return;
    }
    this.state = {
      date: today,
      secondsToday: 0,
    };
    this.sessionStartMs = nowMs;
  }

  private elapsedSessionSeconds(nowMs: number): number {
    return Math.max(0, Math.floor((nowMs - this.sessionStartMs) / 1000));
  }

  private async resolveStatePath(path: string): Promise<string> {
    try {
      const pathStat = await stat(path);
      if (pathStat.isDirectory()) {
        return join(path, "screen-time.json");
      }
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code !== "ENOENT") {
        throw error;
      }
    }
    return path;
  }

  private static todayKey(nowMs = Date.now()): string {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}
