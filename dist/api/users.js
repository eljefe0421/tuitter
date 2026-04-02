import { DEFAULT_USER_FIELDS } from "./fields.js";
export async function getAuthenticatedUser(client) {
    const response = await client.get("users/me", {
        "user.fields": DEFAULT_USER_FIELDS,
    });
    return response.data.data;
}
export async function getUserByUsername(client, username) {
    const response = await client.get(`users/by/username/${username}`, {
        "user.fields": DEFAULT_USER_FIELDS,
    });
    return response.data.data;
}
