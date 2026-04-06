import { Box, InputRenderable, InputRenderableEvents, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { searchLocal } from "../../api/local-adapter.js";
import type { ExpandedPost } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class SearchView implements TuitterView {
  private readonly viewId = "search";
  private readonly scrollId = "search-scroll";
  private readonly ctx: ViewContext;
  private readonly input: InputRenderable;
  private readonly enterHandler: (value: string) => void;
  private results: ExpandedPost[] = [];
  private selectedIndex = 0;
  private inResultsMode = false;
  private lastQuery = "";
  private savedScrollTop = 0;
  private shouldScrollSelectionIntoView = false;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.input = new InputRenderable(ctx.renderer, {
      id: "search-input",
      width: 56,
      placeholder: "Search bookmarks...",
      maxLength: 100,
      backgroundColor: theme.backgroundMuted,
      focusedBackgroundColor: theme.surface,
      textColor: theme.textPrimary,
      cursorColor: theme.accent,
    });
    this.enterHandler = (value: string) => {
      this.executeSearch(value);
    };
    this.input.on(InputRenderableEvents.ENTER, this.enterHandler);
  }

  public onEnter(): void {
    this.input.focus();
  }

  public onExit(): void {
    this.input.off(InputRenderableEvents.ENTER, this.enterHandler);
  }

  public render(): ViewDescriptor {
    this.captureScrollTop();

    const inputSection = Box(
      {
        width: "100%",
        maxWidth: layout.contentColumnMaxWidth,
        borderStyle: "rounded",
        borderColor: this.inResultsMode ? theme.border : theme.accent,
        backgroundColor: theme.surface,
        padding: 1,
        gap: 1,
        flexDirection: "column",
      },
      Text({ content: "Search Bookmarks", fg: theme.textPrimary }),
      this.input,
      Text({
        content: this.lastQuery
          ? `${this.results.length} results for "${this.lastQuery}"`
          : "Type a query and press Enter.",
        fg: theme.textMuted,
      }),
    );

    if (this.results.length === 0) {
      return {
        title: "Search",
        hints: "Enter: search | Esc: back",
        content: Box(
          {
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.background,
            flexDirection: "column",
            gap: 2,
          },
          inputSection,
        ),
      };
    }

    const useInlineOverlay = !this.ctx.inlineImageManager.isDisabled();
    const resultCards = this.results.map((item, index) => {
      const selected = this.inResultsMode && index === this.selectedIndex;
      return renderPostCard(item, {
        id: this.getPostCardId(item.post.id),
        selected,
        avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
        useInlineAvatarOverlay: useInlineOverlay,
      });
    });

    return {
      title: `Search: "${this.lastQuery}" (${this.results.length})`,
      hints: this.inResultsMode
        ? "j/k: nav | Enter: detail | p: profile | Tab: back to search | Esc: back"
        : "Enter: search | Tab: browse results | Esc: back",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          backgroundColor: theme.background,
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
        },
        Box(
          {
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            paddingTop: 1,
          },
          inputSection,
        ),
        ScrollBox(
          {
            id: this.scrollId,
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            flexGrow: 1,
            viewportCulling: true,
            contentOptions: { padding: 1 },
          },
          ...resultCards,
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
      this.scrollSelectedIntoView();
    }

    if (this.ctx.inlineImageManager.isDisabled() || this.results.length === 0) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const avatarImages = this.results.map((item) => ({
      viewId: this.viewId,
      postId: item.post.id,
      kind: "avatar" as const,
      imageUrl: item.author?.profile_image_url,
      anchorId: this.getPostAvatarAnchorId(item.post.id),
      viewportAnchorId: this.scrollId,
    }));

    await this.ctx.inlineImageManager.reconcileMany(avatarImages);
  }

  public async handleKey(key: KeyEvent): Promise<boolean> {
    if (isKey(key, "tab")) {
      this.inResultsMode = !this.inResultsMode;
      if (!this.inResultsMode) {
        this.input.focus();
      }
      return true;
    }

    if (this.inResultsMode) {
      if (isKey(key, "j", "down")) {
        this.selectedIndex = Math.min(this.results.length - 1, this.selectedIndex + 1);
        this.shouldScrollSelectionIntoView = true;
        return true;
      }

      if (isKey(key, "k", "up")) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.shouldScrollSelectionIntoView = true;
        return true;
      }

      const selected = this.results[this.selectedIndex];
      if (!selected) return false;

      if (isKey(key, "return", "enter")) {
        await this.ctx.pushPostDetail(selected);
        return true;
      }

      if (isKey(key, "p")) {
        const username = selected.author?.username;
        if (username) await this.ctx.pushProfile(username);
        return true;
      }
    }

    if (isKey(key, "escape")) {
      if (this.inResultsMode) {
        this.inResultsMode = false;
        this.input.focus();
        return true;
      }
      this.ctx.popView();
      return true;
    }

    return false;
  }

  private executeSearch(value: string): void {
    const query = value.trim();
    if (!query) return;

    this.lastQuery = query;
    this.ctx.setStatus(`Searching "${query}"...`);
    const page = searchLocal(query);
    this.results = page.items;
    this.selectedIndex = 0;
    this.inResultsMode = this.results.length > 0;
    this.ctx.setStatus(`${this.results.length} results for "${query}".`);
  }

  private getPostCardId(postId: string): string {
    return `search-post-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `search-avatar-${postId}`;
  }

  private scrollSelectedIntoView(): void {
    const selected = this.results[this.selectedIndex];
    if (!selected) return;
    setTimeout(() => {
      const scrollBox = this.ctx.renderer.root.findDescendantById(this.scrollId) as any;
      scrollBox?.scrollChildIntoView?.(this.getPostCardId(selected.post.id));
    }, 0);
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
