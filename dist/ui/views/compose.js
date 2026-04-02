import { Box, InputRenderable, InputRenderableEvents, Text } from "@opentui/core";
import { replyToPost } from "../../api/posts.js";
import { theme } from "../theme.js";
import { isKey } from "./contracts.js";
export class ComposeView {
    ctx;
    request;
    input;
    submitting = false;
    enterHandler;
    constructor(ctx, request) {
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
        this.enterHandler = (value) => {
            void this.submit(value);
        };
        this.input.on(InputRenderableEvents.ENTER, this.enterHandler);
    }
    onEnter() {
        this.input.focus();
    }
    onExit() {
        this.input.off(InputRenderableEvents.ENTER, this.enterHandler);
    }
    render() {
        return {
            title: "Compose Reply",
            hints: "Enter: submit | Esc: cancel",
            content: Box({
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.background,
            }, Box({
                width: "80%",
                borderStyle: "rounded",
                borderColor: theme.accent,
                backgroundColor: theme.surface,
                padding: 1,
                gap: 1,
                flexDirection: "column",
            }, Text({ content: "Reply", fg: theme.textPrimary }), this.input, Text({
                content: this.submitting ? "Posting..." : "Enter submits reply to selected post.",
                fg: theme.textMuted,
            }))),
        };
    }
    handleKey(key) {
        if (isKey(key, "escape")) {
            this.ctx.popView();
            return true;
        }
        return false;
    }
    async submit(text) {
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
        }
        catch (error) {
            this.ctx.setStatus(`Reply failed: ${error.message}`);
        }
        finally {
            this.submitting = false;
        }
    }
}
