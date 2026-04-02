import { FrameBufferRenderable, RGBA, h } from "@opentui/core";
class ImagePreviewRenderable extends FrameBufferRenderable {
    image;
    drawn = false;
    constructor(ctx, options) {
        super(ctx, options);
        this.image = options.image;
    }
    onResize(width, height) {
        super.onResize(width, height);
        this.drawn = false;
    }
    renderSelf(buffer) {
        this.ensureImageDrawn();
        super.renderSelf(buffer);
    }
    ensureImageDrawn() {
        if (this.drawn) {
            return;
        }
        this.frameBuffer.clear(RGBA.fromInts(0, 0, 0, 0));
        const { width, height, pixels } = this.image;
        const maxY = Math.min(height, this.frameBuffer.height);
        const maxX = Math.min(width, this.frameBuffer.width);
        for (let y = 0; y < maxY; y += 1) {
            for (let x = 0; x < maxX; x += 1) {
                const offset = (y * width + x) * 4;
                const color = RGBA.fromInts(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0, pixels[offset + 3] ?? 255);
                this.frameBuffer.setCell(x, y, " ", color, color);
            }
        }
        this.drawn = true;
    }
}
export function renderImagePreview(image, options = {}) {
    return h(ImagePreviewRenderable, {
        ...options,
        width: image.width,
        height: image.height,
        respectAlpha: true,
        image,
    });
}
