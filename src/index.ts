import { createCliRenderer } from "@opentui/core";
import { loadConfig } from "./config.js";
import { getStats } from "./db.js";
import { ScreenTimeTracker } from "./screen-time.js";
import { TuitterApp } from "./ui/app.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // Verify DB connection before launching the UI
  const stats = getStats();
  console.log(`tuitter — ${stats.bookmarks.toLocaleString()} bookmarks, ${stats.categories} categories, ${stats.authors} authors`);

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    autoFocus: true,
    targetFps: 30,
  });

  const screenTimeTracker = new ScreenTimeTracker(config.screenTimeStatePath, config.screenTimeMaxSeconds);

  let app: TuitterApp | undefined;
  try {
    app = new TuitterApp(renderer, config.xImageMode, screenTimeTracker);
    await app.start();
  } catch (error) {
    renderer.destroy();
    throw error;
  }

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    void app?.stop();
    renderer.destroy();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    void app?.stop();
    renderer.destroy();
    process.exit(1);
  });
}

void main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
