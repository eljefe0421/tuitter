import { XApiError } from "./client.js";
import { expandPosts } from "./expansion.js";
import { DEFAULT_EXPANSIONS, DEFAULT_MEDIA_FIELDS, DEFAULT_TWEET_FIELDS, DEFAULT_USER_FIELDS } from "./fields.js";
function isReply(post) {
    if (post.in_reply_to_user_id) {
        return true;
    }
    return post.referenced_tweets?.some((reference) => reference.type === "replied_to") ?? false;
}
function mapPage(response, options = {}) {
    const posts = (response.data ?? []).filter((post) => !options.excludeReplies || !isReply(post));
    return {
        items: expandPosts(posts, response.includes),
        nextToken: response.meta?.next_token,
        previousToken: response.meta?.previous_token,
        rawMeta: response.meta,
    };
}
function timelineQuery(options) {
    return {
        max_results: options.maxResults ?? 20,
        pagination_token: options.paginationToken,
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        "media.fields": DEFAULT_MEDIA_FIELDS,
        expansions: DEFAULT_EXPANSIONS,
    };
}
function userTimelineQuery(options) {
    return {
        ...timelineQuery(options),
        exclude: options.excludeReplies ? "replies" : undefined,
    };
}
async function tryTimelineEndpoint(client, primaryPath, fallbackPath, options) {
    try {
        const primary = await client.get(primaryPath, timelineQuery(options));
        return mapPage(primary.data, options);
    }
    catch (primaryError) {
        try {
            const fallback = await client.get(fallbackPath, timelineQuery(options));
            return mapPage(fallback.data, options);
        }
        catch (fallbackError) {
            // Preserve the fallback error if it's meaningful; otherwise surface primary.
            if (fallbackError instanceof XApiError) {
                throw fallbackError;
            }
            throw primaryError;
        }
    }
}
export async function getHomeTimeline(client, userId, options = {}) {
    try {
        return await tryTimelineEndpoint(client, `users/${userId}/timelines/reverse_chronological`, `users/${userId}/reverse_chronological`, options);
    }
    catch (error) {
        // Some X app access tiers do not expose home timeline; fallback to user timeline.
        if (error instanceof XApiError && error.status === 404) {
            return getUserTimeline(client, userId, options);
        }
        throw error;
    }
}
export async function getUserTimeline(client, userId, options = {}) {
    const response = await client.get(`users/${userId}/tweets`, userTimelineQuery(options));
    return mapPage(response.data, options);
}
