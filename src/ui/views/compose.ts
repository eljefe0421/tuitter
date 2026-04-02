import { Box, InputRenderable, InputRenderableEvents, Text, type KeyEvent } from "@opentui/core";
import { replyToPost } from "../../api/posts.js";
import { theme } from "../theme.js";
import type { TuitterView, ComposerRequest, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class ComposeView implements TuitterView {
  private readonly ctx: ViewContext;
  private readonly request: ComposerRequest;
  private readonly input: InputRenderable;
  private submitting = false;
  private enterHandler: (value: string) => void;

  public constructor(ctx: ViewContext, request: ComposerRequest) {
    this.ctx = ctx;
    this.request = request;
    this.input = new InputRenderable(ctx.renderer, {
      id: "compose-input",
      width: 70,
      placeholder: "Write a reply and press Enter to post...",
      value: request.defaultText ?? "",
      maxLength: 280,
      backgroundColor: theme.backgroundMuted,
      focusedBackgroundColor: theme.surface,
      textColor: theme.textPrimary,
      cursorColor: theme.accent,
    });

    this.enterHandler = (value: string) => {
      void this.submit(value);
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
    return {
      title: "Compose Reply",
      hints: "Enter: submit | Esc: cancel",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        },
        Box(
          {
            width: "80%",
            borderStyle: "rounded",
            borderColor: theme.accent,
            backgroundColor: theme.surface,
            padding: 1,
            gap: 1,
            flexDirection: "column",
          },
          Text({ content: "Reply", fg: theme.textPrimary }),
          this.input,
          Text({
            content: this.submitting ? "Posting..." : "Enter submits reply to selected post.",
            fg: theme.textMuted,
          }),
        ),
      ),
    };
  }

  public handleKey(key: KeyEvent): boolean {
    if (isKey(key, "escape")) {
      this.ctx.popView();
      return true;
    }
    return false;
  }

  private async submit(text: string): Promise<void> {
    if (this.submitting) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      this.ctx.setStatus("Reply text cannot be empty.");
      return;
    }

    this.submitting = true;
    this.ctx.setStatus("Posting reply...");
    try {
      await replyToPost(this.ctx.client, this.request.inReplyToPostId, trimmed);
      this.ctx.setStatus("Reply posted.");
      this.ctx.popView();
    } catch (error) {
      this.ctx.setStatus(`Reply failed: ${(error as Error).message}`);
    } finally {
      this.submitting = false;
    }
  }
}
