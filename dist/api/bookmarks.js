export async function bookmarkPost(client, userId, postId) {
    const response = await client.post(`users/${userId}/bookmarks`, { tweet_id: postId });
    return { success: response.data.data.bookmarked };
}
export async function unbookmarkPost(client, userId, postId) {
    const response = await client.delete(`users/${userId}/bookmarks/${postId}`);
    return { success: !response.data.data.bookmarked };
}
