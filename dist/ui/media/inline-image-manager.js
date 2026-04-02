import { KittyInlineImageBackend } from "./kitty-backend.js";
import { getInlineImageData } from "./post-image-preview.js";
export class InlineImageManager {
    renderer;
    configuredMode;
    setStatus;
    kittyBackend = new KittyInlineImageBackend();
    activeKittyImages = new Map();
    warnedUnavailable = false;
    warnedFailure = false;
    reconcileSequence = 0;
    constructor(renderer, configuredMode, setStatus) {
        this.renderer = renderer;
        this.configuredMode = configuredMode;
        this.setStatus = setStatus;
    }
    isDisabled() {
        return this.resolveMode() === "off";
    }
    async reconcile(desired) {
        return this.reconcileMany(desired ? [desired] : []);
    }
    async reconcileMany(desiredStates) {
        const sequence = ++this.reconcileSequence;
        const mode = this.resolveMode();
        if (mode !== this.kittyBackend.name) {
            if (sequence !== this.reconcileSequence) {
                return mode;
            }
            await this.hideAllKittyImages();
            return mode;
        }
        if (desiredStates.length === 0) {
            if (sequence !== this.reconcileSequence) {
                return mode;
            }
            await this.hideAllKittyImages();
            return mode;
        }
        const desiredImageIds = new Set();
        for (const desired of desiredStates) {
            if (!desired.imageUrl || !desired.anchorId || !desired.postId) {
                continue;
            }
            const placement = this.getPlacementForAnchor(desired.anchorId, desired.viewportAnchorId, desired.kind === "avatar" ? "fully-visible" : "allow-clipped");
            if (!placement) {
                continue;
            }
            const imageId = this.getImageId(desired);
            desiredImageIds.add(imageId);
            let asset;
            try {
                asset = await getInlineImageData(desired.imageUrl, {
                    maxWidthPx: placement.pixelWidth,
                    maxHeightPx: placement.pixelHeight,
                });
            }
            catch (error) {
                await this.hideKittyImageById(imageId);
                if (!this.warnedFailure) {
                    this.warnedFailure = true;
                    this.setStatus(`Kitty image processing failed: ${error.message}`);
                }
                continue;
            }
            if (sequence !== this.reconcileSequence) {
                return mode;
            }
            if (!asset) {
                await this.hideKittyImageById(imageId);
                continue;
            }
            const displayPlacement = this.computeDisplayPlacementForAsset(placement, asset.width, asset.height);
            const request = {
                imageId,
                imageKey: `${desired.imageUrl}::${asset.width}x${asset.height}`,
                placement: displayPlacement,
                asset: {
                    cacheKey: asset.cacheKey,
                    width: asset.width,
                    height: asset.height,
                    pngData: asset.pngData,
                },
            };
            const placementKey = this.formatPlacementKey(displayPlacement);
            const active = this.activeKittyImages.get(imageId);
            const isUnchanged = active?.imageKey === request.imageKey && active.placementKey === placementKey;
            if (isUnchanged) {
                continue;
            }
            try {
                if (active) {
                    await this.kittyBackend.update(request);
                }
                else {
                    await this.kittyBackend.show(request);
                }
            }
            catch (error) {
                await this.hideKittyImageById(imageId);
                if (!this.warnedFailure) {
                    this.warnedFailure = true;
                    this.setStatus(`Kitty image rendering failed: ${error.message}`);
                }
                continue;
            }
            if (sequence !== this.reconcileSequence) {
                await this.kittyBackend.hide(imageId);
                return mode;
            }
            this.activeKittyImages.set(imageId, {
                imageId,
                imageKey: request.imageKey,
                placementKey,
                viewId: desired.viewId,
            });
        }
        if (sequence !== this.reconcileSequence) {
            return mode;
        }
        await this.hideImagesNotInSet(desiredImageIds);
        return mode;
    }
    async clearView(viewId) {
        this.reconcileSequence += 1;
        const idsToHide = [...this.activeKittyImages.values()]
            .filter((state) => state.viewId === viewId)
            .map((state) => state.imageId);
        for (const imageId of idsToHide) {
            await this.hideKittyImageById(imageId);
        }
    }
    async clearAll() {
        this.reconcileSequence += 1;
        await this.kittyBackend.clearAll();
        this.activeKittyImages.clear();
    }
    resolveMode() {
        if (this.configuredMode === "off") {
            return "off";
        }
        const kittyAvailable = this.kittyBackend.isAvailable(this.renderer);
        if (kittyAvailable) {
            return "kitty";
        }
        if (this.configuredMode === "kitty" && !this.warnedUnavailable) {
            this.warnedUnavailable = true;
            this.setStatus("Kitty graphics unavailable in this terminal.");
        }
        return "off";
    }
    getImageId(desired) {
        return `${desired.viewId}:${desired.kind ?? "media"}:${desired.postId}`;
    }
    async hideKittyImageById(imageId) {
        if (!this.activeKittyImages.has(imageId)) {
            return;
        }
        await this.kittyBackend.hide(imageId);
        this.activeKittyImages.delete(imageId);
    }
    async hideAllKittyImages() {
        const activeIds = [...this.activeKittyImages.keys()];
        for (const imageId of activeIds) {
            await this.hideKittyImageById(imageId);
        }
    }
    async hideImagesNotInSet(desiredImageIds) {
        const staleIds = [...this.activeKittyImages.keys()].filter((imageId) => !desiredImageIds.has(imageId));
        for (const imageId of staleIds) {
            await this.hideKittyImageById(imageId);
        }
    }
    getPlacementForAnchor(anchorId, viewportAnchorId, visibilityMode = "allow-clipped") {
        const anchor = this.renderer.root.findDescendantById(anchorId);
        if (!anchor) {
            return undefined;
        }
        const x = Math.floor(anchor.x);
        const y = Math.floor(anchor.y);
        const width = Math.floor(anchor.width);
        const height = Math.floor(anchor.height);
        if (width <= 0 || height <= 0) {
            return undefined;
        }
        const terminalWidth = Math.max(1, this.renderer.width);
        const terminalHeight = Math.max(1, this.renderer.height);
        const clipRect = this.getClipRect(terminalWidth, terminalHeight, viewportAnchorId);
        if (!clipRect) {
            return undefined;
        }
        if (visibilityMode === "fully-visible") {
            const isFullyVisible = x >= clipRect.left &&
                y >= clipRect.top &&
                x + width <= clipRect.right &&
                y + height <= clipRect.bottom;
            if (!isFullyVisible) {
                return undefined;
            }
        }
        // Clip using box edges so partially/fully off-screen anchors are handled correctly.
        const left = x;
        const top = y;
        const right = x + width;
        const bottom = y + height;
        const clippedLeft = Math.max(clipRect.left, left);
        const clippedTop = Math.max(clipRect.top, top);
        const clippedRight = Math.min(clipRect.right, right);
        const clippedBottom = Math.min(clipRect.bottom, bottom);
        const clippedWidth = clippedRight - clippedLeft;
        const clippedHeight = clippedBottom - clippedTop;
        if (clippedWidth <= 0 || clippedHeight <= 0) {
            return undefined;
        }
        const cellPixelWidth = this.getCellPixelWidth();
        const cellPixelHeight = this.getCellPixelHeight();
        return {
            x: clippedLeft,
            y: clippedTop,
            width: clippedWidth,
            height: clippedHeight,
            pixelWidth: Math.max(16, Math.round(clippedWidth * cellPixelWidth)),
            pixelHeight: Math.max(16, Math.round(clippedHeight * cellPixelHeight)),
        };
    }
    getClipRect(terminalWidth, terminalHeight, viewportAnchorId) {
        const terminalRect = {
            left: 0,
            top: 0,
            right: terminalWidth,
            bottom: terminalHeight,
        };
        if (!viewportAnchorId) {
            return terminalRect;
        }
        const viewport = this.renderer.root.findDescendantById(viewportAnchorId);
        if (!viewport) {
            return undefined;
        }
        const viewportLeft = Math.floor(viewport.x);
        const viewportTop = Math.floor(viewport.y);
        const viewportRight = viewportLeft + Math.floor(viewport.width);
        const viewportBottom = viewportTop + Math.floor(viewport.height);
        const clipped = {
            left: Math.max(terminalRect.left, viewportLeft),
            top: Math.max(terminalRect.top, viewportTop),
            right: Math.min(terminalRect.right, viewportRight),
            bottom: Math.min(terminalRect.bottom, viewportBottom),
        };
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) {
            return undefined;
        }
        return clipped;
    }
    getCellPixelWidth() {
        const resolution = this.renderer.resolution;
        const terminalWidth = Math.max(1, this.renderer.terminalWidth || this.renderer.width);
        if (!resolution?.width) {
            return 8;
        }
        return Math.max(1, resolution.width / terminalWidth);
    }
    getCellPixelHeight() {
        const resolution = this.renderer.resolution;
        const terminalHeight = Math.max(1, this.renderer.terminalHeight || this.renderer.height);
        if (!resolution?.height) {
            return 16;
        }
        return Math.max(1, resolution.height / terminalHeight);
    }
    formatPlacementKey(placement) {
        return `${placement.x},${placement.y},${placement.width},${placement.height},${placement.pixelWidth},${placement.pixelHeight}`;
    }
    computeDisplayPlacementForAsset(basePlacement, imagePixelWidth, imagePixelHeight) {
        const cellPixelHeight = Math.max(1, basePlacement.pixelHeight / Math.max(1, basePlacement.height));
        const widthCells = Math.max(1, basePlacement.width);
        const widthPx = Math.max(1, basePlacement.pixelWidth);
        const targetHeightPx = Math.min(basePlacement.pixelHeight, Math.max(cellPixelHeight, Math.round((widthPx * Math.max(1, imagePixelHeight)) / Math.max(1, imagePixelWidth))));
        const heightCells = Math.max(1, Math.min(basePlacement.height, Math.round(targetHeightPx / cellPixelHeight)));
        const renderHeightPx = Math.max(1, Math.round(heightCells * cellPixelHeight));
        return {
            ...basePlacement,
            width: widthCells,
            height: heightCells,
            pixelWidth: widthPx,
            pixelHeight: renderHeightPx,
        };
    }
}
