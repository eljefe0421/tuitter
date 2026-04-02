const ESC = "\u001b";
const ST = `${ESC}\\`;
const KITTY_DATA_CHUNK_SIZE = 4096;
export class KittyInlineImageBackend {
    name = "kitty";
    displayedByImageId = new Map();
    nextKittyImageId = 1;
    isAvailable(renderer) {
        const capabilities = renderer.capabilities;
        if (!process.stdout.isTTY) {
            return false;
        }
        // Multiplexers frequently mangle raw graphics escapes unless passthrough is configured.
        if (Boolean(process.env.TMUX)) {
            return false;
        }
        if (capabilities?.kitty_graphics === true) {
            return true;
        }
        const term = (process.env.TERM ?? "").toLowerCase();
        const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
        if (term.includes("kitty")) {
            return true;
        }
        if (Boolean(process.env.KITTY_WINDOW_ID)) {
            return true;
        }
        if (termProgram.includes("ghostty") || termProgram.includes("wezterm") || termProgram.includes("warp")) {
            return true;
        }
        return false;
    }
    async show(request) {
        await this.renderImage(request);
    }
    async update(request) {
        await this.renderImage(request);
    }
    async hide(imageId) {
        const existing = this.displayedByImageId.get(imageId);
        if (!existing) {
            return;
        }
        this.deleteImage(existing.kittyImageId, true);
        this.displayedByImageId.delete(imageId);
    }
    async clearAll() {
        this.deleteVisiblePlacements();
        this.displayedByImageId.clear();
    }
    async renderImage(request) {
        const kittyImageId = this.allocateKittyImageId();
        const existing = this.displayedByImageId.get(request.imageId);
        if (existing) {
            this.deleteImage(existing.kittyImageId, true);
        }
        this.placeImageByTransmit(request, kittyImageId);
        this.displayedByImageId.set(request.imageId, { kittyImageId });
    }
    placeImageByTransmit(request, kittyImageId) {
        const payload = request.asset.pngData.toString("base64");
        let offset = 0;
        const row = request.placement.y + 1;
        const col = request.placement.x + 1;
        const save = `${ESC}7`;
        const restore = `${ESC}8`;
        const move = `${ESC}[${row};${col}H`;
        process.stdout.write(save);
        process.stdout.write(move);
        while (offset < payload.length) {
            const chunk = payload.slice(offset, offset + KITTY_DATA_CHUNK_SIZE);
            const hasMore = offset + KITTY_DATA_CHUNK_SIZE < payload.length;
            if (offset === 0) {
                this.writeGraphicsCommand({
                    a: "T",
                    t: "d",
                    f: 100,
                    i: kittyImageId,
                    q: 2,
                    C: 1,
                    c: Math.max(1, request.placement.width),
                    r: Math.max(1, request.placement.height),
                    z: 10,
                    m: hasMore ? 1 : 0,
                }, chunk);
            }
            else {
                this.writeGraphicsCommand({
                    q: 2,
                    m: hasMore ? 1 : 0,
                }, chunk);
            }
            offset += KITTY_DATA_CHUNK_SIZE;
        }
        process.stdout.write(restore);
    }
    deleteImage(kittyImageId, deleteData) {
        this.writeGraphicsCommand({
            a: "d",
            d: deleteData ? "I" : "i",
            i: kittyImageId,
            q: 2,
        });
    }
    deleteVisiblePlacements() {
        this.writeGraphicsCommand({
            a: "d",
            d: "A",
            q: 2,
        });
    }
    writeGraphicsCommand(params, payload) {
        const serialized = Object.entries(params)
            .map(([key, value]) => `${key}=${value}`)
            .join(",");
        if (payload === undefined) {
            process.stdout.write(`${ESC}_G${serialized}${ST}`);
            return;
        }
        process.stdout.write(`${ESC}_G${serialized};${payload}${ST}`);
    }
    allocateKittyImageId() {
        const id = this.nextKittyImageId;
        this.nextKittyImageId += 1;
        return id;
    }
}
