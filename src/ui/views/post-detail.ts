import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { getLocalPostDetail } from "../../api/local-adapter.js";
import { getBookmarkDetail } from "../../db.js";
import type { ExpandedPost } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { getPostPrimaryImageDimensions, getPostPrimaryImageUrl } from "../media/post-image-preview.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

const DEFAULT_MEDIA_HEIGHT_ROWS = 12;
const ESTIMATED_POST_CONTENT_WIDTH_CELLS = Math.max(20, layout.contentColumnMaxWidth - 4);

export class PostDetailView implements TuitterView {
  private readonly viewId = "post-detail";
  private readonly scrollId = "post-detail-scroll";
  private readonly ctx: ViewContext;
  private readonly rootPost: ExpandedPost;
  private categories: string[] = [];
  private semanticTags: string[] = [];
  private savedScrollTop = 0;

  public constructor(ctx: ViewContext, rootPost: ExpandedPost) {
    this.ctx = ctx;
    this.rootPost = rootPost;
  }

  public onEnter(): void {
    // Load enrichment metadata from the DB
    const detail = getBookmarkDetail(this.rootPost.post.id);
    if (detail) {
      if (detail.categories) {
        this.categories = detail.categories.split(",").map((s) => s.trim());
      }
      if (detail.semanticTags) {
        try {
          const parsed = JSON.parse(detail.semanticTags);
          this.semanticTags = Array.isArray(parsed) ? parsed : [];
        } catch {
          this.semanticTags = [];
        }
      }
      // Upgrade media if the detail has more than the summary row
      const fullPost = getLocalPostDetail(this.rootPost.post.id);
      if (fullPost && fullPost.media && fullPost.media.length > (this.rootPost.media?.length ?? 0)) {
        (this.rootPost as any).media = fullPost.media;
      }
    }
  }

  public async onExit(): Promise<void> {
    await this.ctx.inlineImageManager.clearView(this.viewId);
  }

  public render(): ViewDescriptor {
    this.captureScrollTop();
    const useInlineOverlay = !this.ctx.inlineImageManager.isDisabled();

    const metaChildren: any[] = [];

    if (this.categories.length > 0) {
      metaChildren.push(
        Box(
          { width: "100%", flexDirection: "row", gap: 1 },
          Text({ content: "Categories:", fg: theme.accent }),
          Text({ content: this.categories.join(", "), fg: theme.textPrimary }),
        ),
      );
    }

    if (this.semanticTags.length > 0) {
      metaChildren.push(
        Box(
          { width: "100%", flexDirection: "row", gap: 1 },
          Text({ content: "Tags:", fg: theme.accent }),
          Text({ content: this.semanticTags.join(", "), fg: theme.textPrimary }),
        ),
      );
    }

    return {
      title: "Bookmark Detail",
      hints: "p: profile | q: back",
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
          renderPostCard(this.rootPost, {
            id: `post-detail-card-${this.rootPost.post.id}`,
            selected: true,
            avatarAnchorId: this.getPostAvatarAnchorId(this.rootPost.post.id),
            useInlineAvatarOverlay: useInlineOverlay,
            mediaAnchorId: this.getPostMediaAnchorId(this.rootPost.post.id),
            mediaAnchorHeight: this.getMediaAnchorHeightRows(this.rootPost),
            useInlineMediaOverlay: useInlineOverlay,
          }),
          ...(metaChildren.length > 0
            ? [
                Box(
                  {
                    width: "100%",
                    borderStyle: "rounded",
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                    padding: 1,
                    flexDirection: "column",
                    gap: 1,
                  },
                  Text({ content: "Enrichment", fg: theme.accent }),
                  ...metaChildren,
                ),
              ]
            : []),
        ),
      ),
    };
  }

  public onAfterRenderSync(): void {
    this.restoreScrollTop();
  }

  public async onDidRender(): Promise<void> {
    if (this.ctx.inlineImageManager.isDisabled()) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const mediaUrl = getPostPrimaryImageUrl(this.rootPost);
    await this.ctx.inlineImageManager.reconcileMany([
      {
        viewId: this.viewId,
        postId: this.rootPost.post.id,
        kind: "avatar" as const,
        imageUrl: this.rootPost.author?.profile_image_url,
        anchorId: this.getPostAvatarAnchorId(this.rootPost.post.id),
      },
      {
        viewId: this.viewId,
        postId: this.rootPost.post.id,
        kind: "media" as const,
        imageUrl: mediaUrl,
        anchorId: this.getPostMediaAnchorId(this.rootPost.post.id),
      },
    ]);
  }

  public async handleKey(key: KeyEvent): Promise<boolean> {
    if (isKey(key, "p")) {
      const username = this.rootPost.author?.username;
      if (!username) {
        this.ctx.setStatus("No author info.");
        return true;
      }
      await this.ctx.pushProfile(username);
      return true;
    }

    return false;
  }

  private getPostMediaAnchorId(postId: string): string {
    return `post-detail-media-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `post-detail-avatar-${postId}`;
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

  private captureScrollTop(): void {
    const scrollBox = this.ctx.renderer.root.findDescendantById(this.scrollId) as any;
    if (typeof scrollBox?.scrollTop === "number") {
      this.savedScrollTop = scrollBox.scrollTop;
    }
  }

  private restoreScrollTop(): void {
    const scrollBox = this.ctx.renderer.root.findDescendantById(this.scrollId) as any;
    if (scrollBox && typeof scrollBox.scrollTop === "number") {
      if (scrollBox.scrollTo) {
        scrollBox.scrollTo({ x: 0, y: this.savedScrollTop });
      } else {
        scrollBox.scrollTop = this.savedScrollTop;
      }
    }
  }
}
