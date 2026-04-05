import { Box, CliRenderEvents, type CliRenderer, type KeyEvent } from "@opentui/core";
import { bookmarkPost, likePost, unbookmarkPost, unlikePost } from "../api/index.js";
import { XApiError, type XApiClient } from "../api/client.js";
import type { XImageMode } from "../config.js";
import { ScreenTimeTracker } from "../screen-time.js";
import type { ExpandedPost, XUser } from "../types.js";
import { renderHeaderBar, renderScreenTimeWarning, renderStatusBar } from "./components/index.js";
import { ExplosionAnimation } from "./components/explosion.js";
import { InlineImageManager } from "./media/inline-image-manager.js";
import { theme } from "./theme.js";
import { ComposeView } from "./views/compose.js";
import { isKey, type TuitterView, type ComposerRequest, type ViewContext } from "./views/contracts.js";
import { PostDetailView } from "./views/post-detail.js";
import { ProfileJumpView } from "./views/profile-jump.js";
import { ProfileView } from "./views/profile.js";
import { TimelineView } from "./views/timeline.js";

export class TuitterApp {
  private static readonly PROFILE_JUMP_HINT = "cmd-k: jump profile";
  private readonly renderer: CliRenderer;
  private readonly client: XApiClient;
  private readonly me: XUser;
  private readonly views: TuitterView[] = [];
  private readonly likedPostIds = new Set<string>();
  private readonly bookmarkedPostIds = new Set<string>();
  private statusMessage = "Ready";
  private handlingKey = false;
  private renderCycle = 0;
  private readonly keyHandler: (key: KeyEvent) => void;
  private readonly rendererRefreshHandler: () => void;
  private readonly viewContext: ViewContext;
  private readonly screenTimeTracker?: ScreenTimeTracker;
  private screenTimeTickInterval?: NodeJS.Timeout;
  private lastScreenTimeSeconds = 0;
  private lastCheckpointSeconds = -1;
  private screenTimeWarningShown = false;
  private explosionAnimation?: ExplosionAnimation;
  private explosionInterval?: NodeJS.Timeout;

  private formatDuration(totalSeconds: number): string {
    const clamped = Math.max(0, totalSeconds);
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const seconds = clamped % 60;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  public constructor(
    renderer: CliRenderer,
    client: XApiClient,
    me: XUser,
    imageMode: XImageMode,
    screenTimeTracker?: ScreenTimeTracker,
  ) {
    this.renderer = renderer;
    this.client = client;
    this.me = me;
    this.screenTimeTracker = screenTimeTracker;
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

    this.keyHandler = (key: KeyEvent) => {
      void this.handleKeyPress(key);
    };
    this.rendererRefreshHandler = () => {
      this.render();
    };
  }

  public async start(): Promise<void> {
    if (this.screenTimeTracker) {
      await this.screenTimeTracker.initialize();
      const snapshot = this.screenTimeTracker.snapshot();
      this.lastScreenTimeSeconds = snapshot.secondsToday;
      this.screenTimeWarningShown = snapshot.exceeded;
      if (snapshot.exceeded) {
        this.statusMessage = "Daily screen-time limit reached.";
        await this.viewContext.inlineImageManager.clearAll();
      }
      this.screenTimeTickInterval = setInterval(() => {
        void this.tickScreenTime();
      }, 1000);
    }

    // Kitty graphics writes use process.stdout directly.
    // OpenTUI intercepts stdout by default, which can swallow those escapes.
    this.renderer.disableStdoutInterception();
    this.renderer.on(CliRenderEvents.RESIZE, this.rendererRefreshHandler);
    this.renderer.on(CliRenderEvents.CAPABILITIES, this.rendererRefreshHandler);
    await this.pushView(new TimelineView(this.viewContext));
    this.renderer.keyInput.on("keypress", this.keyHandler);
  }

  public async stop(): Promise<void> {
    if (this.screenTimeTickInterval) {
      clearInterval(this.screenTimeTickInterval);
      this.screenTimeTickInterval = undefined;
    }
    if (this.explosionInterval) {
      clearInterval(this.explosionInterval);
      this.explosionInterval = undefined;
    }
    this.explosionAnimation = undefined;
    if (this.screenTimeTracker) {
      await this.screenTimeTracker.checkpoint();
    }
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

  private async pushView(view: TuitterView): Promise<void> {
    // Prevent stuck kitty overlays when transitioning to another view.
    await this.viewContext.inlineImageManager.clearAll();
    this.views.push(view);
    await view.onEnter();
    this.render();
  }

  private async popView(): Promise<void> {
    if (this.views.length <= 1) {
      await this.stop();
      this.renderer.destroy();
      return;
    }

    const current = this.views.pop();
    await current?.onExit?.();
    this.render();
  }

  private currentView(): TuitterView | undefined {
    return this.views[this.views.length - 1];
  }

  private render(): void {
    const view = this.currentView();
    if (!view) {
      return;
    }
    this.renderCycle += 1;
    const cycle = this.renderCycle;

    const descriptor = view.render();
    this.clearRoot();

    const screenTimeSnapshot = this.screenTimeTracker?.snapshot();
    const screenTimeIndicator = this.getScreenTimeIndicator(screenTimeSnapshot);
    const statusMessage = this.withScreenTimeStatus(this.statusMessage, screenTimeSnapshot);
    const hints = this.isScreenTimeBlocked() || this.explosionAnimation ? "q/esc: exit" : this.withGlobalHints(descriptor.hints);
    const shellChildren: any[] = [renderHeaderBar(descriptor.title, screenTimeIndicator)];
    shellChildren.push(
      Box(
        {
          id: "shell-content",
          width: "100%",
          flexGrow: 1,
          backgroundColor: theme.background,
        },
        descriptor.content as any,
      ),
    );
    shellChildren.push(renderStatusBar(statusMessage, hints, this.renderer.width));

    const rootChildren: any[] = [
      Box(
        {
          id: "tuitter-shell",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          backgroundColor: theme.background,
        },
        ...shellChildren,
      ),
    ];
    if (this.explosionAnimation) {
      rootChildren.push(this.explosionAnimation.render());
    } else if (screenTimeSnapshot?.exceeded && screenTimeSnapshot.maxSeconds !== undefined) {
      rootChildren.push(renderScreenTimeWarning(screenTimeSnapshot.secondsToday, screenTimeSnapshot.maxSeconds));
    }
    for (const child of rootChildren) {
      this.renderer.root.add(child);
    }
    view.onAfterRenderSync?.();

    void this.renderer.idle().then(async () => {
      if (cycle !== this.renderCycle || this.currentView() !== view) {
        return;
      }
      if (this.isScreenTimeBlocked() || this.explosionAnimation) {
        return;
      }
      await view.onDidRender?.();
    }).catch((error) => {
      this.statusMessage = `Error: ${this.formatError(error)}`;
      this.render();
    });
  }

  private clearRoot(): void {
    for (const child of this.renderer.root.getChildren()) {
      this.renderer.root.remove(child.id);
    }
  }

  private async handleKeyPress(key: KeyEvent): Promise<void> {
    if (this.handlingKey) {
      return;
    }
    this.handlingKey = true;

    try {
      if (this.isScreenTimeBlocked() || this.isScreenTimeExceeded()) {
        if (key.name === "q" || key.name === "escape") {
          await this.stop();
          this.renderer.destroy();
        }
        return;
      }

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
    } catch (error) {
      this.statusMessage = `Error: ${this.formatError(error)}`;
      this.render();
    } finally {
      this.handlingKey = false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof XApiError && error.status === 403) {
      return `${error.message}. Check X app permissions and requested OAuth scopes (tweet.read/users.read/tweet.write/like.write/bookmark.write).`;
    }
    return (error as Error).message;
  }

  private async tickScreenTime(): Promise<void> {
    if (!this.screenTimeTracker) {
      return;
    }

    const snapshot = this.screenTimeTracker.snapshot();
    if (snapshot.secondsToday !== this.lastScreenTimeSeconds) {
      this.lastScreenTimeSeconds = snapshot.secondsToday;
      if (snapshot.maxSeconds !== undefined) {
        this.updateLiveScreenTimeDisplay(snapshot);
      }
    }

    if (snapshot.exceeded && !this.screenTimeWarningShown && !this.explosionAnimation) {
      this.statusMessage = "Daily screen-time limit reached.";
      await this.viewContext.inlineImageManager.clearAll();
      this.startExplosion();
    }

    if (snapshot.secondsToday % 10 === 0 && snapshot.secondsToday !== this.lastCheckpointSeconds) {
      await this.screenTimeTracker.checkpoint();
      this.lastCheckpointSeconds = snapshot.secondsToday;
    }
  }

  private updateLiveScreenTimeDisplay(snapshot: {
    secondsToday: number;
    maxSeconds?: number;
    exceeded: boolean;
  }): void {
    if (snapshot.maxSeconds === undefined) {
      return;
    }

    const remainingSeconds = snapshot.maxSeconds - snapshot.secondsToday;
    const headerColor =
      remainingSeconds < 10 ? theme.danger : remainingSeconds < 60 ? theme.warning : theme.success;

    const headerTimer = this.renderer.root.findDescendantById("header-screen-time") as
      | { content?: string; fg?: string; requestRender?: () => void }
      | undefined;
    if (headerTimer) {
      headerTimer.content = `  left ${this.formatDuration(remainingSeconds)}`;
      headerTimer.fg = headerColor;
      headerTimer.requestRender?.();
    }

    const warningUsage = this.renderer.root.findDescendantById("screen-time-warning-usage") as
      | { content?: string; requestRender?: () => void }
      | undefined;
    if (warningUsage) {
      warningUsage.content = `You used ${this.formatDuration(snapshot.secondsToday)} / ${this.formatDuration(snapshot.maxSeconds)} today.`;
      warningUsage.requestRender?.();
    }
  }

  private startExplosion(): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    this.explosionAnimation = new ExplosionAnimation(cols, rows);
    this.render();
    this.explosionInterval = setInterval(() => {
      if (!this.explosionAnimation) {
        return;
      }
      this.explosionAnimation.advance();
      if (this.explosionAnimation.isComplete()) {
        clearInterval(this.explosionInterval!);
        this.explosionInterval = undefined;
        this.explosionAnimation = undefined;
        this.screenTimeWarningShown = true;
        this.render();
        return;
      }
      this.render();
    }, 50);
  }

  private withScreenTimeStatus(
    baseMessage: string,
    snapshot: { secondsToday: number; maxSeconds?: number; exceeded: boolean } | undefined,
  ): string {
    if (!snapshot || snapshot.maxSeconds === undefined) {
      return baseMessage;
    }
    const used = this.formatDuration(snapshot.secondsToday);
    const max = this.formatDuration(snapshot.maxSeconds);
    const remaining = this.formatDuration(snapshot.maxSeconds - snapshot.secondsToday);
    const timer = `Screen: ${used}/${max} (left ${remaining})`;

    if (snapshot.exceeded) {
      return `Daily screen-time limit reached. ${timer}`;
    }
    return `${baseMessage} | ${timer}`;
  }

  private isScreenTimeExceeded(): boolean {
    return this.screenTimeTracker?.snapshot().exceeded ?? false;
  }

  private isScreenTimeBlocked(): boolean {
    return this.screenTimeWarningShown;
  }

  private getScreenTimeIndicator(
    snapshot: { secondsToday: number; maxSeconds?: number; exceeded: boolean } | undefined,
  ): { text: string; color: string } | undefined {
    if (!snapshot || snapshot.maxSeconds === undefined) {
      return undefined;
    }
    const remainingSeconds = snapshot.maxSeconds - snapshot.secondsToday;
    const color =
      remainingSeconds < 10 ? theme.danger : remainingSeconds < 60 ? theme.warning : theme.success;
    return {
      text: `left ${this.formatDuration(remainingSeconds)}`,
      color,
    };
  }

  private async handleGlobalKey(key: KeyEvent): Promise<boolean> {
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

  private withGlobalHints(viewHints: string): string {
    if (viewHints.includes("cmd-k")) {
      return viewHints;
    }
    return `${viewHints} | ${TuitterApp.PROFILE_JUMP_HINT}`;
  }

  private isProfileJumpShortcut(key: KeyEvent): boolean {
    const hasCommandModifier = key.meta || key.super;
    if (!hasCommandModifier) {
      return false;
    }
    return isKey(key, "k", "p");
  }

  private async toggleLike(postId: string): Promise<boolean> {
    if (this.likedPostIds.has(postId)) {
      await unlikePost(this.client, this.me.id, postId);
      this.likedPostIds.delete(postId);
      return false;
    }
    await likePost(this.client, this.me.id, postId);
    this.likedPostIds.add(postId);
    return true;
  }

  private async toggleBookmark(postId: string): Promise<boolean> {
    if (this.bookmarkedPostIds.has(postId)) {
      await unbookmarkPost(this.client, this.me.id, postId);
      this.bookmarkedPostIds.delete(postId);
      return false;
    }
    await bookmarkPost(this.client, this.me.id, postId);
    this.bookmarkedPostIds.add(postId);
    return true;
  }

  public async openComposer(request: ComposerRequest): Promise<void> {
    await this.pushView(new ComposeView(this.viewContext, request));
  }

  public async openPostDetail(post: ExpandedPost): Promise<void> {
    await this.pushView(new PostDetailView(this.viewContext, post));
  }
}
