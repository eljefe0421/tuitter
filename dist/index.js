import { createCliRenderer } from "@opentui/core";
import { XApiClient } from "./api/client.js";
import { getAuthenticatedUser } from "./api/users.js";
import { OAuthSession } from "./auth/oauth-session.js";
import { loadConfig } from "./config.js";
import { TuitterApp } from "./ui/app.js";
async function main() {
    const config = loadConfig();
    const oauthSession = new OAuthSession(config.oauth);
    await oauthSession.getAccessToken();
    const renderer = await createCliRenderer({
        exitOnCtrlC: true,
        useMouse: true,
        autoFocus: true,
        targetFps: 30,
    });
    const client = new XApiClient(config, () => oauthSession.getAccessToken(), {
        onUnauthorized: () => oauthSession.forceRefresh(),
    });
    let app;
    try {
        const me = await getAuthenticatedUser(client);
        app = new TuitterApp(renderer, client, me, config.xImageMode);
        await app.start();
    }
    catch (error) {
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
