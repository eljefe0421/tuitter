import { expandPosts } from "./expansion.js";
import { DEFAULT_EXPANSIONS, DEFAULT_MEDIA_FIELDS, DEFAULT_TWEET_FIELDS, DEFAULT_USER_FIELDS } from "./fields.js";
export async function getPostById(client, postId) {
    const response = await client.get(`tweets/${postId}`, {
        expansions: DEFAULT_EXPANSIONS,
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        "media.fields": DEFAULT_MEDIA_FIELDS,
    });
    const posts = expandPosts([response.data.data], response.data.includes);
    return posts[0];
}
export async function getConversationReplies(client, conversationId) {
    const response = await client.get("tweets/search/recent", {
        query: `conversation_id:${conversationId}`,
        expansions: DEFAULT_EXPANSIONS,
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        "media.fields": DEFAULT_MEDIA_FIELDS,
        max_results: 100,
    });
    const items = expandPosts(response.data.data ?? [], response.data.includes);
    return items.sort((a, b) => (a.post.created_at ?? "").localeCompare(b.post.created_at ?? ""));
}
export async function createPost(client, text) {
    const response = await client.post("tweets", { text });
    return response.data.data;
}
export async function replyToPost(client, inReplyToTweetId, text) {
    const response = await client.post("tweets", {
        text,
        reply: {
            in_reply_to_tweet_id: inReplyToTweetId,
        },
    });
    return response.data.data;
}
