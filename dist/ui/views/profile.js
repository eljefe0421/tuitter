import { Box, ScrollBox, Text } from "@opentui/core";
import { getUserTimeline } from "../../api/timeline.js";
import { getUserByUsername } from "../../api/users.js";
import { renderPostCard } from "../components/post-card.js";
import { renderUserInfo } from "../components/user-info.js";
import { layout, theme } from "../theme.js";
import { isKey } from "./contracts.js";
export class ProfileView {
    viewId = "profile";
    scrollId = "profile-posts-scroll";
    ctx;
    username;
    user;
    posts = [];
    selectedIndex = 0;
    loading = false;
    loadingPosts = false;
    nextToken;
    constructor(ctx, username) {
        this.ctx = ctx;
        this.username = username;
    }
    async onEnter() {
        if (!this.user) {
            await this.loadProfile();
        }
    }
    async onExit() {
        await this.ctx.inlineImageManager.clearView(this.viewId);
    }
    render() {
        if (!this.user) {
            return {
                title: `Profile @${this.username}`,
                hints: "q: back",
                content: Box({
                    width: "100%",
                    height: "100%",
                    justifyContent: "center",
                    alignItems: "center",
                }, Text({ content: this.loading ? "Loading profile..." : "Profile unavailable.", fg: theme.textMuted })),
            };
        }
        const children = this.posts.length
            ? this.posts.map((item, index) => renderPostCard(item, {
                id: this.getPostCardId(item.post.id),
                selected: index === this.selectedIndex,
                liked: this.ctx.isLiked(item.post.id),
                bookmarked: this.ctx.isBookmarked(item.post.id),
                avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
                useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
            }))
            : [
                Box({
                    width: "100%",
                    padding: 1,
                    borderStyle: "rounded",
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                }, Text({ content: this.loadingPosts ? "Loading posts..." : "No posts found.", fg: theme.textMuted })),
            ];
        return {
            title: `Profile @${this.user.username}`,
            hints: "j/k: navigate | l: like | b: bookmark | r: reply | Enter: open post | q: back",
            content: Box({
                width: "100%",
                height: "100%",
                alignItems: "center",
                backgroundColor: theme.background,
                paddingLeft: 1,
                paddingRight: 1,
            }, Box({
                width: "100%",
                maxWidth: layout.contentColumnMaxWidth,
                height: "100%",
                flexDirection: "column",
                gap: 1,
                paddingTop: 1,
                paddingBottom: 1,
            }, renderUserInfo(this.user, {
                avatarAnchorId: this.getHeaderAvatarAnchorId(this.user.id),
                useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
            }), ScrollBox({
                id: this.scrollId,
                width: "100%",
                height: "100%",
                viewportCulling: true,
                contentOptions: {
                    padding: 1,
                },
            }, ...children))),
        };
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
        const selected = this.posts[this.selectedIndex];
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
        if (isKey(key, "return", "enter")) {
            await this.ctx.pushPostDetail(selected);
            return true;
        }
        return false;
    }
    async onDidRender() {
        if (!this.user || this.ctx.inlineImageManager.isDisabled()) {
            await this.ctx.inlineImageManager.reconcileMany([]);
            return;
        }
        const desiredImages = [
            {
                viewId: this.viewId,
                postId: `header-${this.user.id}`,
                kind: "avatar",
                imageUrl: this.user.profile_image_url,
                anchorId: this.getHeaderAvatarAnchorId(this.user.id),
            },
            ...this.posts.map((item) => ({
                viewId: this.viewId,
                postId: item.post.id,
                kind: "avatar",
                imageUrl: item.author?.profile_image_url,
                anchorId: this.getPostAvatarAnchorId(item.post.id),
                viewportAnchorId: this.scrollId,
            })),
        ];
        await this.ctx.inlineImageManager.reconcileMany(desiredImages);
    }
    getHeaderAvatarAnchorId(userId) {
        return `profile-header-avatar-${userId}`;
    }
    async moveSelection(delta) {
        if (this.posts.length === 0) {
            this.selectedIndex = 0;
            return;
        }
        const next = Math.max(0, Math.min(this.posts.length - 1, this.selectedIndex + delta));
        this.selectedIndex = next;
        this.scrollSelectedIntoView();
        if (this.nextToken && this.selectedIndex >= this.posts.length - 3) {
            await this.loadMorePosts();
            this.scrollSelectedIntoView();
        }
    }
    getPostCardId(postId) {
        return `profile-post-${postId}`;
    }
    getPostAvatarAnchorId(postId) {
        return `profile-avatar-${postId}`;
    }
    scrollSelectedIntoView() {
        const selected = this.posts[this.selectedIndex];
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
    async loadProfile() {
        this.loading = true;
        this.ctx.setStatus(`Loading profile @${this.username}...`);
        try {
            this.user = await getUserByUsername(this.ctx.client, this.username);
            await this.loadMorePosts();
            this.ctx.setStatus(`Loaded profile @${this.username}.`);
        }
        catch (error) {
            this.ctx.setStatus(`Profile request failed: ${error.message}`);
        }
        finally {
            this.loading = false;
        }
    }
    async loadMorePosts() {
        if (!this.user || this.loadingPosts) {
            return;
        }
        this.loadingPosts = true;
        try {
            const page = await getUserTimeline(this.ctx.client, this.user.id, {
                paginationToken: this.nextToken,
                maxResults: 20,
                excludeReplies: true,
            });
            this.posts = [...this.posts, ...page.items];
            this.nextToken = page.nextToken;
        }
        catch (error) {
            this.ctx.setStatus(`Could not load user posts: ${error.message}`);
        }
        finally {
            this.loadingPosts = false;
        }
    }
}
