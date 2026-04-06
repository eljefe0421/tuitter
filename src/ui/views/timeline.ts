import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { getLocalTimeline } from "../../api/local-adapter.js";
import { getStats } from "../../db.js";
import type { ExpandedPost } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { getPostPrimaryImageDimensions, getPostPrimaryImageUrl } from "../media/post-image-preview.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

const DEFAULT_MEDIA_HEIGHT_ROWS = 12;
const ESTIMATED_POST_CONTENT_WIDTH_CELLS = Math.max(20, layout.contentColumnMaxWidth - 4);

export class TimelineView implements TuitterView {
  private readonly viewId = "timeline";
  private readonly scrollId = "timeline-scroll";
  private readonly ctx: ViewContext;
  private readonly categorySlug?: string;
  private readonly categoryName?: string;
  private items: ExpandedPost[] = [];
  private selectedIndex = 0;
  private offset = 0;
  private hasMore = false;
  private loading = false;
  private savedScrollTop = 0;
  private shouldScrollSelectionIntoView = false;

  public constructor(ctx: ViewContext, categorySlug?: string, categoryName?: string) {
    this.ctx = ctx;
    this.categorySlug = categorySlug;
    this.categoryName = categoryName;
  }

  public async onEnter(): Promise<void> {
    if (this.items.length === 0) {
      this.loadMore();
    }
  }

  public async onExit(): Promise<void> {
    await this.ctx.inlineImageManager.clearView(this.viewId);
  }

  public render(): ViewDescriptor {
    this.captureScrollTop();
    const stats = getStats();
    const title = this.categoryName
      ? `${this.categoryName}`
      : `Bookmarks (${stats.bookmarks.toLocaleString()})`;

    if (this.items.length === 0 && this.loading) {
      return {
        title,
        hints: "/: search | c: categories | q: back",
        content: Box(
          { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
          Text({ content: "Loading bookmarks...", fg: theme.textMuted }),
        ),
      };
    }

    if (this.items.length === 0) {
      return {
        title,
        hints: "/: search | c: categories | q: back",
        content: Box(
          { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
          Text({ content: "No bookmarks found.", fg: theme.textMuted }),
        ),
      };
    }

    const useInlineOverlay = !this.ctx.inlineImageManager.isDisabled();
    const children = this.items.map((item, index) => {
      const selected = index === this.selectedIndex;
      return renderPostCard(item, {
        id: this.getPostCardId(item.post.id),
        selected,
        avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
        useInlineAvatarOverlay: useInlineOverlay,
        mediaAnchorId: selected ? this.getPostMediaAnchorId(item.post.id) : undefined,
        mediaAnchorHeight: selected ? this.getMediaAnchorHeightRows(item) : undefined,
        useInlineMediaOverlay: selected && useInlineOverlay,
      });
    });

    return {
      title,
      hints: "j/k: nav | Enter: detail | p: profile | /: search | c: categories | q: back",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          backgroundColor: theme.background,
          paddingLeft: 1,
          paddingRight: 1,
        },
        ScrollBox(
          {
            id: this.scrollId,
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            height: "100%",
            viewportCulling: true,
            rootOptions: { backgroundColor: theme.background },
            contentOptions: { padding: 1 },
          },
          ...children,
        ),
      ),
    };
  }

  public onAfterRenderSync(): void {
    this.restoreScrollTop();
  }

  public async onDidRender(): Promise<void> {
    if (this.shouldScrollSelectionIntoView) {
      this.shouldScrollSelectionIntoView = false;
      await this.scrollSelectedIntoView();
    }

    const selected = this.items[this.selectedIndex];
    if (!selected || this.ctx.inlineImageManager.isDisabled()) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const avatarImages = this.items.map((item) => ({
      viewId: this.viewId,
      postId: item.post.id,
      kind: "avatar" as const,
      imageUrl: item.author?.profile_image_url,
      anchorId: this.getPostAvatarAnchorId(item.post.id),
      viewportAnchorId: this.scrollId,
    }));

    const mediaUrl = getPostPrimaryImageUrl(selected);
    await this.ctx.inlineImageManager.reconcileMany([
      ...avatarImages,
      {
        viewId: this.viewId,
        postId: selected.post.id,
        kind: "media" as const,
        imageUrl: mediaUrl,
        anchorId: this.getPostMediaAnchorId(selected.post.id),
        viewportAnchorId: this.scrollId,
      },
    ]);
  }

  public async handleKey(key: KeyEvent): Promise<boolean> {
    if (isKey(key, "j", "down")) {
      this.moveSelection(1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      this.moveSelection(-1);
      return true;
    }

    const selected = this.items[this.selectedIndex];
    if (!selected) return false;

    if (isKey(key, "return", "enter")) {
      await this.ctx.pushPostDetail(selected);
      return true;
    }

    if (isKey(key, "p")) {
      const username = selected.author?.username;
      if (!username) {
        this.ctx.setStatus("No author info.");
        return true;
      }
      await this.ctx.pushProfile(username);
      return true;
    }

    return false;
  }

  private moveSelection(delta: number): void {
    const nextIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
    this.selectedIndex = nextIndex;
    this.shouldScrollSelectionIntoView = true;
    if (this.hasMore && this.selectedIndex >= this.items.length - 3) {
      this.loadMore();
    }
  }

  private getPostCardId(postId: string): string {
    return `timeline-post-${postId}`;
  }

  private getPostMediaAnchorId(postId: string): string {
    return `timeline-media-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `timeline-avatar-${postId}`;
  }

  private getMediaAnchorHeightRows(item: ExpandedPost): number {
    const dimensions = getPostPrimaryImageDimensions(item);
    if (!dimensions) return DEFAULT_MEDIA_HEIGHT_ROWS;

    const cellPixelWidth = this.getCellPixelWidth();
    const cellPixelHeight = this.getCellPixelHeight();
    const targetWidthPx = Math.max(1, Math.round(ESTIMATED_POST_CONTENT_WIDTH_CELLS * cellPixelWidth));
    const targetHeightPx = Math.max(
      cellPixelHeight,
      Math.round((targetWidthPx * dimensions.height) / Math.max(1, dimensions.width)),
    );
    return Math.max(1, Math.ceil(targetHeightPx / cellPixelHeight));
  }

  private getCellPixelWidth(): number {
    const resolution = this.ctx.renderer.resolution;
    const terminalWidth = Math.max(1, this.ctx.renderer.terminalWidth || this.ctx.renderer.width);
    if (!resolution?.width) return 8;
    return Math.max(1, resolution.width / terminalWidth);
  }

  private getCellPixelHeight(): number {
    const resolution = this.ctx.renderer.resolution;
    const terminalHeight = Math.max(1, this.ctx.renderer.terminalHeight || this.ctx.renderer.height);
    if (!resolution?.height) return 16;
    return Math.max(1, resolution.height / terminalHeight);
  }

  private async scrollSelectedIntoView(): Promise<void> {
    const selected = this.items[this.selectedIndex];
    if (!selected) return;
    await this.scrollSelectedIntoViewWithRetry(this.getPostCardId(selected.post.id), 0);
  }

  private async scrollSelectedIntoViewWithRetry(selectedCardId: string, attempt: number): Promise<void> {
    const scrollBox = this.getScrollBox();
    if (!scrollBox?.scrollChildIntoView) {
      if (attempt < 4) {
        await this.delay(16);
        await this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
      }
      return;
    }

    const before = scrollBox.scrollTop;
    scrollBox.scrollChildIntoView(selectedCardId);
    const after = scrollBox.scrollTop;
    if (typeof after === "number") {
      this.savedScrollTop = after;
    }

    if (before === after && attempt < 4) {
      await this.delay(16);
      await this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
      return;
    }

    await this.ctx.renderer.idle();
  }

  private getScrollBox(): {
    scrollChildIntoView?: (childId: string) => void;
    scrollTop?: number;
    scrollTo?: (position: number | { x: number; y: number }) => void;
  } | undefined {
    return this.ctx.renderer.root.findDescendantById(this.scrollId) as any;
  }

  private captureScrollTop(): void {
    const scrollBox = this.getScrollBox();
    if (typeof scrollBox?.scrollTop === "number") {
      this.savedScrollTop = scrollBox.scrollTop;
    }
  }

  private restoreScrollTop(): void {
    const scrollBox = this.getScrollBox();
    if (scrollBox && typeof scrollBox.scrollTop === "number") {
      if (scrollBox.scrollTo) {
        scrollBox.scrollTo({ x: 0, y: this.savedScrollTop });
      } else {
        scrollBox.scrollTop = this.savedScrollTop;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private loadMore(): void {
    if (this.loading) return;
    this.loading = true;
    this.ctx.setStatus("Loading bookmarks...");

    const page = getLocalTimeline({
      offset: this.offset,
      maxResults: 20,
      categorySlug: this.categorySlug,
    });
    this.items = [...this.items, ...page.items];
    this.hasMore = !!page.nextToken;
    if (page.nextToken) {
      this.offset = Number.parseInt(page.nextToken, 10);
    }
    this.ctx.setStatus(`Loaded ${this.items.length} bookmarks.`);
    this.loading = false;
  }
}
