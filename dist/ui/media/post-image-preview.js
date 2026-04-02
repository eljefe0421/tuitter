import { Jimp, JimpMime } from "jimp";
const DEFAULT_MAX_WIDTH = 40;
const DEFAULT_MAX_HEIGHT = 12;
const CELL_ASPECT_RATIO = 0.5;
const previewCache = new Map();
const inlineImageCache = new Map();
function fitPreviewSize(sourceWidth, sourceHeight, maxWidth, maxHeight) {
    const safeSourceWidth = Math.max(1, sourceWidth);
    const safeSourceHeight = Math.max(1, sourceHeight);
    const adjustedHeight = safeSourceHeight * CELL_ASPECT_RATIO;
    const scale = Math.min(maxWidth / safeSourceWidth, maxHeight / adjustedHeight, 1);
    return {
        width: Math.max(1, Math.round(safeSourceWidth * scale)),
        height: Math.max(1, Math.round(safeSourceHeight * scale * CELL_ASPECT_RATIO)),
    };
}
function fitBoundingSize(sourceWidth, sourceHeight, maxWidth, maxHeight) {
    const safeSourceWidth = Math.max(1, sourceWidth);
    const safeSourceHeight = Math.max(1, sourceHeight);
    const scale = Math.min(maxWidth / safeSourceWidth, maxHeight / safeSourceHeight, 1);
    return {
        width: Math.max(1, Math.round(safeSourceWidth * scale)),
        height: Math.max(1, Math.round(safeSourceHeight * scale)),
    };
}
function normalizePreviewOptions(options = {}) {
    return {
        maxWidth: Math.max(4, options.maxWidth ?? DEFAULT_MAX_WIDTH),
        maxHeight: Math.max(2, options.maxHeight ?? DEFAULT_MAX_HEIGHT),
    };
}
function normalizeInlineOptions(options) {
    return {
        maxWidthPx: Math.max(16, Math.round(options.maxWidthPx)),
        maxHeightPx: Math.max(16, Math.round(options.maxHeightPx)),
    };
}
function getPostPrimaryMedia(post) {
    const media = post.media ?? [];
    const photo = media.find((item) => item.type === "photo" && (item.url || item.preview_image_url));
    if (photo) {
        return photo;
    }
    const previewableMedia = media.find((item) => item.preview_image_url || item.url);
    return previewableMedia;
}
export function getPostPrimaryImageUrl(post) {
    const media = getPostPrimaryMedia(post);
    return media?.url ?? media?.preview_image_url;
}
export function getPostPrimaryImageDimensions(post) {
    const media = getPostPrimaryMedia(post);
    if (!media?.width || !media?.height) {
        return undefined;
    }
    if (media.width <= 0 || media.height <= 0) {
        return undefined;
    }
    return { width: media.width, height: media.height };
}
export async function getImagePreview(imageUrl, options = {}) {
    const normalized = normalizePreviewOptions(options);
    const cacheKey = `${imageUrl}::${normalized.maxWidth}x${normalized.maxHeight}`;
    const cached = previewCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const pending = (async () => {
        try {
            const image = await Jimp.read(imageUrl);
            const target = fitPreviewSize(image.bitmap.width, image.bitmap.height, normalized.maxWidth, normalized.maxHeight);
            image.resize({ w: target.width, h: target.height });
            return {
                width: target.width,
                height: target.height,
                pixels: Uint8Array.from(image.bitmap.data),
            };
        }
        catch {
            return undefined;
        }
    })();
    previewCache.set(cacheKey, pending);
    return pending;
}
export async function getInlineImageData(imageUrl, options) {
    const normalized = normalizeInlineOptions(options);
    const cacheKey = `${imageUrl}::inline::${normalized.maxWidthPx}x${normalized.maxHeightPx}`;
    const cached = inlineImageCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const pending = (async () => {
        try {
            const image = await Jimp.read(imageUrl);
            const target = fitBoundingSize(image.bitmap.width, image.bitmap.height, normalized.maxWidthPx, normalized.maxHeightPx);
            image.resize({ w: target.width, h: target.height });
            const pngData = await image.getBuffer(JimpMime.png);
            return {
                cacheKey: `${imageUrl}::${target.width}x${target.height}`,
                width: target.width,
                height: target.height,
                pngData,
            };
        }
        catch (error) {
            inlineImageCache.delete(cacheKey);
            throw error;
        }
    })();
    inlineImageCache.set(cacheKey, pending);
    return pending;
}
