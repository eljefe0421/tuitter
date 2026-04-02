import { Box, CliRenderEvents } from "@opentui/core";
import { bookmarkPost, likePost, unbookmarkPost, unlikePost } from "../api/index.js";
import { XApiError } from "../api/client.js";
import { renderHeaderBar, renderStatusBar } from "./components/index.js";
import { InlineImageManager } from "./media/inline-image-manager.js";
import { theme } from "./theme.js";
import { ComposeView } from "./views/compose.js";
import { isKey } from "./views/contracts.js";
import { PostDetailView } from "./views/post-detail.js";
import { ProfileJumpView } from "./views/profile-jump.js";
import { ProfileView } from "./views/profile.js";
import { TimelineView } from "./views/timeline.js";
export class TuitterApp {
    static PROFILE_JUMP_HINT = "cmd-k: jump profile";
    renderer;
    client;
    me;
    views = [];
    likedPostIds = new Set();
    bookmarkedPostIds = new Set();
    statusMessage = "Ready";
    handlingKey = false;
    renderCycle = 0;
    keyHandler;
    rendererRefreshHandler;
    viewContext;
    constructor(renderer, client, me, imageMode) {
        this.renderer = renderer;
        this.client = client;
        this.me = me;
        const inlineImageManager = new InlineImageManager(this.renderer, imageMode, (message) => {
            this.statusMessage = message;
        });
        this.viewContext = {
            renderer: this.renderer,
            inlineImageManager,
            client: this.client,
            me: this.me,
            setStatus: (message) => {
                this.statusMessage = message;
            },
            pushPostDetail: async (post) => this.pushView(new PostDetailView(this.viewContext, post)),
            pushProfile: async (username) => this.pushView(new ProfileView(this.viewContext, username)),
            pushComposer: async (request) => this.pushView(new ComposeView(this.viewContext, request)),
            popView: () => {
                void this.popView();
            },
            toggleLike: async (postId) => this.toggleLike(postId),
            toggleBookmark: async (postId) => this.toggleBookmark(postId),
            isLiked: (postId) => this.likedPostIds.has(postId),
            isBookmarked: (postId) => this.bookmarkedPostIds.has(postId),
        };
        this.keyHandler = (key) => {
            void this.handleKeyPress(key);
        };
        this.rendererRefreshHandler = () => {
            this.render();
        };
    }
    async start() {
        // Kitty graphics writes use process.stdout directly.
        // OpenTUI intercepts stdout by default, which can swallow those escapes.
        this.renderer.disableStdoutInterception();
        this.renderer.on(CliRenderEvents.RESIZE, this.rendererRefreshHandler);
        this.renderer.on(CliRenderEvents.CAPABILITIES, this.rendererRefreshHandler);
        await this.pushView(new TimelineView(this.viewContext));
        this.renderer.keyInput.on("keypress", this.keyHandler);
    }
    async stop() {
        this.renderer.keyInput.off("keypress", this.keyHandler);
        this.renderer.off(CliRenderEvents.RESIZE, this.rendererRefreshHandler);
        this.renderer.off(CliRenderEvents.CAPABILITIES, this.rendererRefreshHandler);
        for (const view of this.views) {
            await view.onExit?.();
        }
        this.views.length = 0;
        await this.viewContext.inlineImageManager.clearAll();
        this.clearRoot();
    }
    async pushView(view) {
        // Prevent stuck kitty overlays when transitioning to another view.
        await this.viewContext.inlineImageManager.clearAll();
        this.views.push(view);
        await view.onEnter();
        this.render();
    }
    async popView() {
        if (this.views.length <= 1) {
            await this.stop();
            this.renderer.destroy();
            return;
        }
        const current = this.views.pop();
        await current?.onExit?.();
        this.render();
    }
    currentView() {
        return this.views[this.views.length - 1];
    }
    render() {
        const view = this.currentView();
        if (!view) {
            return;
        }
        this.renderCycle += 1;
        const cycle = this.renderCycle;
        const descriptor = view.render();
        this.clearRoot();
        this.renderer.root.add(Box({
            id: "tuitter-shell",
            width: "100%",
            height: "100%",
            flexDirection: "column",
            backgroundColor: theme.background,
        }, renderHeaderBar(descriptor.title), Box({
            id: "shell-content",
            width: "100%",
            flexGrow: 1,
            backgroundColor: theme.background,
        }, descriptor.content), renderStatusBar(this.statusMessage, this.withGlobalHints(descriptor.hints))));
        void this.renderer.idle().then(async () => {
            if (cycle !== this.renderCycle || this.currentView() !== view) {
                return;
            }
            await view.onDidRender?.();
        }).catch((error) => {
            this.statusMessage = `Error: ${this.formatError(error)}`;
            this.render();
        });
    }
    clearRoot() {
        for (const child of this.renderer.root.getChildren()) {
            this.renderer.root.remove(child.id);
        }
    }
    async handleKeyPress(key) {
        if (this.handlingKey) {
            return;
        }
        this.handlingKey = true;
        try {
            const globalHandled = await this.handleGlobalKey(key);
            if (globalHandled) {
                this.render();
                return;
            }
            const view = this.currentView();
            if (!view) {
                return;
            }
            const handled = await view.handleKey(key);
            if (handled) {
                this.render();
            }
        }
        catch (error) {
            this.statusMessage = `Error: ${this.formatError(error)}`;
            this.render();
        }
        finally {
            this.handlingKey = false;
        }
    }
    formatError(error) {
        if (error instanceof XApiError && error.status === 403) {
            return `${error.message}. Check X app permissions and requested OAuth scopes (tweet.read/users.read/tweet.write/like.write/bookmark.write).`;
        }
        return error.message;
    }
    async handleGlobalKey(key) {
        if (this.isProfileJumpShortcut(key)) {
            if (!(this.currentView() instanceof ProfileJumpView)) {
                await this.pushView(new ProfileJumpView(this.viewContext));
            }
            return true;
        }
        if (key.name === "q" || key.name === "escape") {
            await this.popView();
            return true;
        }
        return false;
    }
    withGlobalHints(viewHints) {
        if (viewHints.includes("cmd-k")) {
            return viewHints;
        }
        return `${viewHints} | ${TuitterApp.PROFILE_JUMP_HINT}`;
    }
    isProfileJumpShortcut(key) {
        const hasCommandModifier = key.meta || key.super;
        if (!hasCommandModifier) {
            return false;
        }
        return isKey(key, "k", "p");
    }
    async toggleLike(postId) {
        if (this.likedPostIds.has(postId)) {
            await unlikePost(this.client, this.me.id, postId);
            this.likedPostIds.delete(postId);
            return false;
        }
        await likePost(this.client, this.me.id, postId);
        this.likedPostIds.add(postId);
        return true;
    }
    async toggleBookmark(postId) {
        if (this.bookmarkedPostIds.has(postId)) {
            await unbookmarkPost(this.client, this.me.id, postId);
            this.bookmarkedPostIds.delete(postId);
            return false;
        }
        await bookmarkPost(this.client, this.me.id, postId);
        this.bookmarkedPostIds.add(postId);
        return true;
    }
    async openComposer(request) {
        await this.pushView(new ComposeView(this.viewContext, request));
    }
    async openPostDetail(post) {
        await this.pushView(new PostDetailView(this.viewContext, post));
    }
}
