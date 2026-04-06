import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { listCategories, type CategoryRow } from "../../db.js";
import { theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class CategoryView implements TuitterView {
  private readonly ctx: ViewContext;
  private categories: CategoryRow[] = [];
  private selectedIndex = 0;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  public onEnter(): void {
    this.categories = listCategories();
    this.ctx.setStatus(`${this.categories.length} categories.`);
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

    const children = this.categories.map((cat, index) => {
      const selected = index === this.selectedIndex;
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
    if (isKey(key, "j", "down")) {
      this.selectedIndex = Math.min(this.categories.length - 1, this.selectedIndex + 1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return true;
    }

    if (isKey(key, "return", "enter")) {
      const cat = this.categories[this.selectedIndex];
      if (cat) {
        await this.ctx.pushCategoryTimeline(cat.slug, cat.name);
      }
      return true;
    }

    return false;
  }
}
