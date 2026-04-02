import type { MutationResponse } from "../types.js";
import type { XApiClient } from "./client.js";

interface BookmarkApiResponse {
  data: {
    bookmarked: boolean;
  };
}

export async function bookmarkPost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.post<BookmarkApiResponse>(`users/${userId}/bookmarks`, { tweet_id: postId });
  return { success: response.data.data.bookmarked };
}

export async function unbookmarkPost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.delete<BookmarkApiResponse>(`users/${userId}/bookmarks/${postId}`);
  return { success: !response.data.data.bookmarked };
}
