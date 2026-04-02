import { Box, ScrollBox, Text } from "@opentui/core";
import { getConversationReplies } from "../../api/posts.js";
import { renderPostCard } from "../components/post-card.js";
import { getPostPrimaryImageDimensions, getPostPrimaryImageUrl } from "../media/post-image-preview.js";
import { layout, theme } from "../theme.js";
import { isKey } from "./contracts.js";
const DEFAULT_MEDIA_HEIGHT_ROWS = 12;
const ESTIMATED_POST_CONTENT_WIDTH_CELLS = Math.max(20, layout.contentColumnMaxWidth - 4);
export class PostDetailView {
    viewId = "post-detail";
    scrollId = "post-detail-scroll";
    ctx;
    rootPost;
    replies = [];
    loading = false;
    selectedReplyIndex = -1;
    constructor(ctx, rootPost) {
        this.ctx = ctx;
        this.rootPost = rootPost;
    }
    async onEnter() {
        await this.loadReplies();
    }
    async onExit() {
        await this.ctx.inlineImageManager.clearView(this.viewId);
    }
    render() {
        const useInlineOverlay = !this.ctx.inlineImageManager.isDisabled();
        const replyNodes = this.replies.length
            ? this.replies.map((item, index) => renderPostCard(item, {
                id: this.getPostCardId(item.post.id),
                selected: this.selectedReplyIndex === index,
                liked: this.ctx.isLiked(item.post.id),
                bookmarked: this.ctx.isBookmarked(item.post.id),
                avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
                useInlineAvatarOverlay: useInlineOverlay,
                mediaAnchorId: this.selectedReplyIndex === index ? this.getPostMediaAnchorId(item.post.id) : undefined,
                mediaAnchorHeight: this.selectedReplyIndex === index ? this.getMediaAnchorHeightRows(item) : undefined,
                useInlineMediaOverlay: this.selectedReplyIndex === index && useInlineOverlay,
            }))
            : [
                Box({
                    width: "100%",
                    padding: 1,
                    borderStyle: "rounded",
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                }, Text({
                    content: this.loading ? "Loading replies..." : "No replies found.",
                    fg: theme.textMuted,
                })),
            ];
        return {
            title: "Post Detail",
            hints: "j/k: navigate replies | l: like | b: bookmark | r: reply | Enter: open reply | q: back",
            content: Box({
                width: "100%",
                height: "100%",
                alignItems: "center",
                backgroundColor: theme.background,
                paddingLeft: 1,
                paddingRight: 1,
            }, ScrollBox({
                id: this.scrollId,
                width: "100%",
                maxWidth: layout.contentColumnMaxWidth,
                height: "100%",
                viewportCulling: true,
                rootOptions: {
                    backgroundColor: theme.background,
                },
                contentOptions: {
                    padding: 1,
                },
            }, Box({
                width: "100%",
                flexDirection: "column",
                gap: 1,
            }, Text({ content: "Selected Post", fg: theme.accent }), renderPostCard(this.rootPost, {
                id: this.getPostCardId(this.rootPost.post.id),
                selected: this.selectedReplyIndex === -1,
                liked: this.ctx.isLiked(this.rootPost.post.id),
                bookmarked: this.ctx.isBookmarked(this.rootPost.post.id),
                avatarAnchorId: this.getPostAvatarAnchorId(this.rootPost.post.id),
                useInlineAvatarOverlay: useInlineOverlay,
                mediaAnchorId: this.selectedReplyIndex === -1
                    ? this.getPostMediaAnchorId(this.rootPost.post.id)
                    : undefined,
                mediaAnchorHeight: this.selectedReplyIndex === -1 ? this.getMediaAnchorHeightRows(this.rootPost) : undefined,
                useInlineMediaOverlay: this.selectedReplyIndex === -1 && useInlineOverlay,
            })), Text({ content: "Replies", fg: theme.accent }), ...replyNodes)),
        };
    }
    async onDidRender() {
        const selected = this.getSelectedPost();
        if (!selected || this.ctx.inlineImageManager.isDisabled()) {
            await this.ctx.inlineImageManager.reconcileMany([]);
            return;
        }
        const allPosts = [this.rootPost, ...this.replies];
        const avatarImages = allPosts.map((item) => ({
            viewId: this.viewId,
            postId: item.post.id,
            kind: "avatar",
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
                kind: "media",
                imageUrl: mediaUrl,
                anchorId: this.getPostMediaAnchorId(selected.post.id),
                viewportAnchorId: this.scrollId,
            },
        ]);
    }
    async handleKey(key) {
        if (isKey(key, "j", "down")) {
            await this.moveSelection(1);
            return true;
        }
        if (isKey(key, "k", "up")) {
            await this.moveSelection(-1);
            return true;
        }
        const selected = this.getSelectedPost();
        if (!selected) {
            return false;
        }
        if (isKey(key, "l")) {
            const liked = await this.ctx.toggleLike(selected.post.id);
            this.ctx.setStatus(liked ? "Post liked." : "Like removed.");
            return true;
        }
        if (isKey(key, "b")) {
            const bookmarked = await this.ctx.toggleBookmark(selected.post.id);
            this.ctx.setStatus(bookmarked ? "Post bookmarked." : "Bookmark removed.");
            return true;
        }
        if (isKey(key, "r")) {
            await this.ctx.pushComposer({ inReplyToPostId: selected.post.id });
            return true;
        }
        if (isKey(key, "p")) {
            const username = selected.author?.username;
            if (!username) {
                this.ctx.setStatus("No author profile available.");
                return true;
            }
            await this.ctx.pushProfile(username);
            return true;
        }
        if (isKey(key, "return", "enter") && this.selectedReplyIndex >= 0) {
            await this.ctx.pushPostDetail(selected);
            return true;
        }
        return false;
    }
    getSelectedPost() {
        if (this.selectedReplyIndex === -1) {
            return this.rootPost;
        }
        return this.replies[this.selectedReplyIndex];
    }
    async moveSelection(delta) {
        if (this.replies.length === 0) {
            this.selectedReplyIndex = -1;
            return;
        }
        const min = -1;
        const max = this.replies.length - 1;
        this.selectedReplyIndex = Math.max(min, Math.min(max, this.selectedReplyIndex + delta));
        this.scrollSelectedIntoView();
    }
    getPostCardId(postId) {
        return `post-detail-post-${postId}`;
    }
    getPostMediaAnchorId(postId) {
        return `post-detail-media-${postId}`;
    }
    getPostAvatarAnchorId(postId) {
        return `post-detail-avatar-${postId}`;
    }
    scrollSelectedIntoView() {
        const selected = this.getSelectedPost();
        if (!selected) {
            return;
        }
        this.scrollSelectedIntoViewWithRetry(this.getPostCardId(selected.post.id), 0);
    }
    scrollSelectedIntoViewWithRetry(selectedCardId, attempt) {
        setTimeout(() => {
            const scrollBox = this.ctx.renderer.root.findDescendantById(this.scrollId);
            if (!scrollBox?.scrollChildIntoView) {
                if (attempt < 4) {
                    this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
                }
                return;
            }
            const before = scrollBox.scrollTop;
            scrollBox.scrollChildIntoView(selectedCardId);
            const after = scrollBox.scrollTop;
            if (before === after && attempt < 4) {
                this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
            }
        }, attempt === 0 ? 0 : 16);
    }
    getMediaAnchorHeightRows(item) {
        const dimensions = getPostPrimaryImageDimensions(item);
        if (!dimensions) {
            return DEFAULT_MEDIA_HEIGHT_ROWS;
        }
        const cellPixelWidth = this.getCellPixelWidth();
        const cellPixelHeight = this.getCellPixelHeight();
        const targetWidthPx = Math.max(1, Math.round(ESTIMATED_POST_CONTENT_WIDTH_CELLS * cellPixelWidth));
        const targetHeightPx = Math.max(cellPixelHeight, Math.round((targetWidthPx * dimensions.height) / Math.max(1, dimensions.width)));
        return Math.max(1, Math.ceil(targetHeightPx / cellPixelHeight));
    }
    getCellPixelWidth() {
        const resolution = this.ctx.renderer.resolution;
        const terminalWidth = Math.max(1, this.ctx.renderer.terminalWidth || this.ctx.renderer.width);
        if (!resolution?.width) {
            return 8;
        }
        return Math.max(1, resolution.width / terminalWidth);
    }
    getCellPixelHeight() {
        const resolution = this.ctx.renderer.resolution;
        const terminalHeight = Math.max(1, this.ctx.renderer.terminalHeight || this.ctx.renderer.height);
        if (!resolution?.height) {
            return 16;
        }
        return Math.max(1, resolution.height / terminalHeight);
    }
    async loadReplies() {
        const conversationId = this.rootPost.post.conversation_id ?? this.rootPost.post.id;
        this.loading = true;
        this.ctx.setStatus("Loading replies...");
        try {
            const replies = await getConversationReplies(this.ctx.client, conversationId);
            this.replies = replies.filter((item) => item.post.id !== this.rootPost.post.id);
            this.ctx.setStatus(`Loaded ${this.replies.length} replies.`);
        }
        catch (error) {
            this.ctx.setStatus(`Failed loading replies: ${error.message}`);
        }
        finally {
            this.loading = false;
        }
    }
}
