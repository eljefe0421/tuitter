export async function likePost(client, userId, postId) {
    const response = await client.post(`users/${userId}/likes`, { tweet_id: postId });
    return { success: response.data.data.liked };
}
export async function unlikePost(client, userId, postId) {
    const response = await client.delete(`users/${userId}/likes/${postId}`);
    return { success: !response.data.data.liked };
}
