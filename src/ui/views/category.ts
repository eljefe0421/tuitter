import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { listCategories, totalBookmarkCount, type CategoryRow } from "../../db.js";
import { theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class CategoryView implements TuitterView {
  private readonly ctx: ViewContext;
  private categories: CategoryRow[] = [];
  private totalCount = 0;
  private selectedIndex = 0;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  public onEnter(): void {
    this.categories = listCategories();
    this.totalCount = totalBookmarkCount();
    this.ctx.setStatus(`${this.categories.length} categories, ${this.totalCount.toLocaleString()} bookmarks.`);
  }

  public render(): ViewDescriptor {
    if (this.categories.length === 0) {
      return {
        title: "Categories",
        hints: "q: back",
        content: Box(
          { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
          Text({ content: "No categories found.", fg: theme.textMuted }),
        ),
      };
    }

    // "All Bookmarks" at index 0, then categories at index 1+
    const allSelected = this.selectedIndex === 0;
    const allRow = Box(
      {
        id: "cat-all",
        width: "100%",
        borderStyle: "rounded",
        borderColor: allSelected ? theme.accent : theme.border,
        backgroundColor: allSelected ? theme.selection : theme.surface,
        padding: 1,
        marginBottom: 1,
        flexDirection: "row",
        gap: 2,
      },
      Box(
        { width: 3, height: 1, alignItems: "center", justifyContent: "center" },
        Text({ content: "★", fg: theme.accentStrong }),
      ),
      Box(
        { flexGrow: 1, flexDirection: "column" },
        Text({ content: "All Bookmarks", fg: theme.textPrimary }),
      ),
      Text({
        content: `${this.totalCount.toLocaleString()}`,
        fg: allSelected ? theme.accentStrong : theme.textMuted,
      }),
    );

    const catRows = this.categories.map((cat, index) => {
      const selected = index + 1 === this.selectedIndex;
      return Box(
        {
          id: `cat-${cat.slug}`,
          width: "100%",
          borderStyle: "rounded",
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.selection : theme.surface,
          padding: 1,
          marginBottom: 1,
          flexDirection: "row",
          gap: 2,
        },
        Box(
          { width: 3, height: 1, alignItems: "center", justifyContent: "center" },
          Text({ content: "●", fg: cat.color }),
        ),
        Box(
          { flexGrow: 1, flexDirection: "column" },
          Text({ content: cat.name, fg: theme.textPrimary }),
          cat.description
            ? Text({
                content:
                  cat.description.length > 80
                    ? cat.description.slice(0, 77) + "..."
                    : cat.description,
                fg: theme.textMuted,
              })
            : null,
        ),
        Text({
          content: `${cat.count.toLocaleString()}`,
          fg: selected ? theme.accentStrong : theme.textMuted,
        }),
      );
    });

    const children = [allRow, ...catRows];

    return {
      title: `Categories (${this.categories.length})`,
      hints: "j/k: nav | Enter: browse | q: back",
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
            id: "category-scroll",
            width: "100%",
            maxWidth: 64,
            height: "100%",
            viewportCulling: true,
            contentOptions: { padding: 1 },
          },
          ...children,
        ),
      ),
    };
  }

  public async handleKey(key: KeyEvent): Promise<boolean> {
    // Total items = 1 (All) + categories.length
    const maxIndex = this.categories.length; // 0 = All, 1..N = categories

    if (isKey(key, "j", "down")) {
      this.selectedIndex = Math.min(maxIndex, this.selectedIndex + 1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return true;
    }

    if (isKey(key, "return", "enter")) {
      if (this.selectedIndex === 0) {
        // "All Bookmarks" — pop category view, go to unfiltered timeline
        this.ctx.popView();
      } else {
        const cat = this.categories[this.selectedIndex - 1];
        if (cat) {
          await this.ctx.pushCategoryTimeline(cat.slug, cat.name);
        }
      }
      return true;
    }

    return false;
  }
}
