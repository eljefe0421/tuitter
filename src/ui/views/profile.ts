import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { getLocalUser, getLocalUserTimeline } from "../../api/local-adapter.js";
import type { ExpandedPost, XUser } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { renderUserInfo } from "../components/user-info.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class ProfileView implements TuitterView {
  private readonly viewId = "profile";
  private readonly scrollId = "profile-posts-scroll";
  private readonly ctx: ViewContext;
  private readonly username: string;
  private user?: XUser;
  private posts: ExpandedPost[] = [];
  private selectedIndex = 0;
  private offset = 0;
  private hasMore = false;
  private savedScrollTop = 0;
  private shouldScrollSelectionIntoView = false;

  public constructor(ctx: ViewContext, username: string) {
    this.ctx = ctx;
    this.username = username;
  }

  public onEnter(): void {
    if (!this.user) {
      this.loadProfile();
    }
  }

  public async onExit(): Promise<void> {
    await this.ctx.inlineImageManager.clearView(this.viewId);
  }

  public render(): ViewDescriptor {
    this.captureScrollTop();
    if (!this.user) {
      return {
        title: `@${this.username}`,
        hints: "q: back",
        content: Box(
          { width: "100%", height: "100%", justifyContent: "center", alignItems: "center" },
          Text({ content: "No bookmarks from this author.", fg: theme.textMuted }),
        ),
      };
    }

    const children = this.posts.length
      ? this.posts.map((item, index) =>
          renderPostCard(item, {
            id: this.getPostCardId(item.post.id),
            selected: index === this.selectedIndex,
            avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
            useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
          }),
        )
      : [
          Box(
            {
              width: "100%",
              padding: 1,
              borderStyle: "rounded",
              borderColor: theme.border,
              backgroundColor: theme.surface,
            },
            Text({ content: "No bookmarks found.", fg: theme.textMuted }),
          ),
        ];

    return {
      title: `@${this.user.username} (${this.user.public_metrics?.tweet_count ?? 0} bookmarks)`,
      hints: "j/k: nav | Enter: detail | q: back",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          backgroundColor: theme.background,
          paddingLeft: 1,
          paddingRight: 1,
        },
        Box(
          {
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            height: "100%",
            flexDirection: "column",
            gap: 1,
            paddingTop: 1,
            paddingBottom: 1,
          },
          renderUserInfo(this.user, {
            avatarAnchorId: this.getHeaderAvatarAnchorId(this.user.id),
            useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
          }),
          ScrollBox(
            {
              id: this.scrollId,
              width: "100%",
              height: "100%",
              viewportCulling: true,
              contentOptions: { padding: 1 },
            },
            ...children,
          ),
        ),
      ),
    };
  }

  public handleKey(key: KeyEvent): boolean {
    if (isKey(key, "j", "down")) {
      this.moveSelection(1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      this.moveSelection(-1);
      return true;
    }

    const selected = this.posts[this.selectedIndex];
    if (!selected) return false;

    if (isKey(key, "return", "enter")) {
      void this.ctx.pushPostDetail(selected);
      return true;
    }

    return false;
  }

  public onAfterRenderSync(): void {
    this.restoreScrollTop();
  }

  public async onDidRender(): Promise<void> {
    if (this.shouldScrollSelectionIntoView) {
      this.shouldScrollSelectionIntoView = false;
      this.scrollSelectedIntoView();
    }

    if (!this.user || this.ctx.inlineImageManager.isDisabled()) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const desiredImages = [
      {
        viewId: this.viewId,
        postId: `header-${this.user.id}`,
        kind: "avatar" as const,
        imageUrl: this.user.profile_image_url,
        anchorId: this.getHeaderAvatarAnchorId(this.user.id),
      },
      ...this.posts.map((item) => ({
        viewId: this.viewId,
        postId: item.post.id,
        kind: "avatar" as const,
        imageUrl: item.author?.profile_image_url,
        anchorId: this.getPostAvatarAnchorId(item.post.id),
        viewportAnchorId: this.scrollId,
      })),
    ];

    await this.ctx.inlineImageManager.reconcileMany(desiredImages);
  }

  private getHeaderAvatarAnchorId(userId: string): string {
    return `profile-header-avatar-${userId}`;
  }

  private moveSelection(delta: number): void {
    if (this.posts.length === 0) {
      this.selectedIndex = 0;
      return;
    }

    const next = Math.max(0, Math.min(this.posts.length - 1, this.selectedIndex + delta));
    this.selectedIndex = next;
    this.shouldScrollSelectionIntoView = true;
    if (this.hasMore && this.selectedIndex >= this.posts.length - 3) {
      this.loadMorePosts();
    }
  }

  private getPostCardId(postId: string): string {
    return `profile-post-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `profile-avatar-${postId}`;
  }

  private scrollSelectedIntoView(): void {
    const selected = this.posts[this.selectedIndex];
    if (!selected) return;
    this.scrollSelectedIntoViewWithRetry(this.getPostCardId(selected.post.id), 0);
  }

  private scrollSelectedIntoViewWithRetry(selectedCardId: string, attempt: number): void {
    setTimeout(() => {
      const scrollBox = this.getScrollBox();
      if (!scrollBox?.scrollChildIntoView) {
        if (attempt < 4) this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
        return;
      }

      const before = scrollBox.scrollTop;
      scrollBox.scrollChildIntoView(selectedCardId);
      const after = scrollBox.scrollTop;
      if (typeof after === "number") this.savedScrollTop = after;

      if (before === after && attempt < 4) {
        this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
      }
    }, attempt === 0 ? 0 : 16);
  }

  private getScrollBox(): any {
    return this.ctx.renderer.root.findDescendantById(this.scrollId);
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

  private loadProfile(): void {
    this.user = getLocalUser(this.username) ?? undefined;
    if (this.user) {
      this.loadMorePosts();
    }
  }

  private loadMorePosts(): void {
    const page = getLocalUserTimeline(this.username, {
      offset: this.offset,
      maxResults: 20,
    });
    this.posts = [...this.posts, ...page.items];
    this.hasMore = !!page.nextToken;
    if (page.nextToken) {
      this.offset = Number.parseInt(page.nextToken, 10);
    }
    this.ctx.setStatus(`@${this.username}: ${this.posts.length} bookmarks.`);
  }
}
