"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QRCodeGenerator = void 0;
const qrcode_1 = __importDefault(require("qrcode"));
let canvasModule;
async function getCanvasModule() {
    if (canvasModule !== undefined)
        return canvasModule;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        canvasModule = require("canvas");
    }
    catch {
        canvasModule = null;
    }
    return canvasModule;
}
const THEMES = {
    default: {
        primary: '#000000',
        secondary: '#0ea5e9',
        background: '#ffffff',
    },
    batman: {
        primary: '#000000',
        secondary: '#ffd700',
        background: '#1a1a1a',
        logoSrc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZDcwMCI+PHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDE1LjkzIDIyTDEyIDE3LjI3IDguMDcgMjIgMTAuOTEgMTUuNzQgMiA5IDguOTEgOC4yNkwxMiAyeiIvPjwvc3ZnPg==',
        shape: 'custom',
    },
    superman: {
        primary: '#003399',
        secondary: '#ff0000',
        background: '#ffffff',
        logoSrc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmMDAwMCI+PHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDE1LjkzIDIyTDEyIDE3LjI3IDguMDcgMjIgMTAuOTEgMTUuNzQgMiA5IDguOTEgOC4yNkwxMiAyeiIvPjwvc3ZnPg==',
        shape: 'custom',
    },
    spiderman: {
        primary: '#ff0000',
        secondary: '#000000',
        background: '#ffffff',
        shape: 'dots',
    },
    ironman: {
        primary: '#cc0000',
        secondary: '#ffd700',
        background: '#1a1a1a',
        shape: 'classy-rounded',
    },
    'captain-america': {
        primary: '#002868',
        secondary: '#ffffff',
        background: '#c8102e',
        shape: 'classy',
    },
    hulk: {
        primary: '#2e7d32',
        secondary: '#4caf50',
        background: '#1b5e20',
        shape: 'dots',
    },
    thor: {
        primary: '#6d4c41',
        secondary: '#ffd700',
        background: '#4e342e',
        shape: 'classy',
    },
    'wonder-woman': {
        primary: '#c62828',
        secondary: '#ffd700',
        background: '#ffffff',
        shape: 'custom',
    },
    flash: {
        primary: '#ff0000',
        secondary: '#ffd700',
        background: '#ffffff',
        shape: 'dots',
    },
    aquaman: {
        primary: '#006064',
        secondary: '#00bcd4',
        background: '#e0f2f1',
        shape: 'rounded',
    },
    'green-lantern': {
        primary: '#004d40',
        secondary: '#a5d6a7',
        background: '#004d40',
        shape: 'classy-rounded',
    },
};
class QRCodeGenerator {
    static DEFAULT_SIZE = 512;
    static async generate(options) {
        const { data, size = this.DEFAULT_SIZE, errorCorrectionLevel = 'H', margin = 2, colorDark, colorLight, logo, shape = 'square', theme = 'default', format = 'png', quality = 0.92, } = options;
        const resolvedTheme = THEMES[theme] || THEMES.default;
        const finalColorDark = colorDark || resolvedTheme.primary;
        const finalColorLight = colorLight || resolvedTheme.background;
        const finalShape = shape === 'custom' && resolvedTheme.shape ? resolvedTheme.shape : shape;
        if (format === 'svg') {
            const svg = await qrcode_1.default.toString(data, {
                type: 'svg',
                errorCorrectionLevel,
                margin,
                color: { dark: finalColorDark, light: finalColorLight },
                width: size,
            });
            return { dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, svg, width: size, height: size };
        }
        const qrCodeDataUrl = await qrcode_1.default.toDataURL(data, {
            errorCorrectionLevel,
            margin,
            color: { dark: finalColorDark, light: finalColorLight },
            width: size,
        });
        if (!logo && theme === 'default' && shape === 'square' && format === 'png') {
            return { dataUrl: qrCodeDataUrl, width: size, height: size };
        }
        const canvasMod = await getCanvasModule();
        if (!canvasMod) {
            // No native canvas available: degrade gracefully to the styled QR that
            // `qrcode` can render on its own (colours are preserved, logos/shapes are not).
            return { dataUrl: qrCodeDataUrl, width: size, height: size };
        }
        const { createCanvas, loadImage } = canvasMod;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = finalColorLight;
        ctx.fillRect(0, 0, size, size);
        const qrImage = await loadImage(qrCodeDataUrl);
        ctx.drawImage(qrImage, 0, 0, size, size);
        if (finalShape !== 'square') {
            this.applyShapeMask(ctx, size, finalShape, finalColorLight);
        }
        if (logo) {
            await this.drawLogo(ctx, size, logo, resolvedTheme, loadImage);
        }
        this.applyThemeEffects(ctx, size, theme, resolvedTheme);
        const buffer = canvas.toBuffer(format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp', { quality });
        const dataUrl = `data:image/${format === 'jpeg' ? 'jpeg' : format};base64,${buffer.toString('base64')}`;
        return { dataUrl, buffer, width: size, height: size };
    }
    static applyShapeMask(ctx, size, shape, backgroundColor) {
        ctx.globalCompositeOperation = 'destination-in';
        switch (shape) {
            case 'rounded':
                this.roundedRect(ctx, size * 0.05, size * 0.05, size * 0.9, size * 0.9, size * 0.15);
                ctx.fill();
                break;
            case 'dots':
                this.drawDotsMask(ctx, size);
                break;
            case 'classy':
                this.classyMask(ctx, size);
                break;
            case 'classy-rounded':
                this.classyRoundedMask(ctx, size);
                break;
            case 'custom':
                this.roundedRect(ctx, size * 0.05, size * 0.05, size * 0.9, size * 0.9, size * 0.15);
                ctx.fill();
                break;
        }
        ctx.globalCompositeOperation = 'source-over';
    }
    static drawDotsMask(ctx, size) {
        const moduleSize = size / 37;
        const modules = 37;
        const offset = (size - modules * moduleSize) / 2;
        for (let row = 0; row < modules; row++) {
            for (let col = 0; col < modules; col++) {
                const x = offset + col * moduleSize + moduleSize / 2;
                const y = offset + row * moduleSize + moduleSize / 2;
                ctx.beginPath();
                ctx.arc(x, y, moduleSize * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    static classyMask(ctx, size) {
        const moduleSize = size / 37;
        const modules = 37;
        const offset = (size - modules * moduleSize) / 2;
        const gap = moduleSize * 0.1;
        for (let row = 0; row < modules; row++) {
            for (let col = 0; col < modules; col++) {
                const x = offset + col * moduleSize + gap / 2;
                const y = offset + row * moduleSize + gap / 2;
                const w = moduleSize - gap;
                const h = moduleSize - gap;
                const r = moduleSize * 0.1;
                this.roundedRect(ctx, x, y, w, h, r);
                ctx.fill();
            }
        }
    }
    static classyRoundedMask(ctx, size) {
        const moduleSize = size / 37;
        const modules = 37;
        const offset = (size - modules * moduleSize) / 2;
        const gap = moduleSize * 0.15;
        for (let row = 0; row < modules; row++) {
            for (let col = 0; col < modules; col++) {
                const x = offset + col * moduleSize + gap / 2;
                const y = offset + row * moduleSize + gap / 2;
                const w = moduleSize - gap;
                const h = moduleSize - gap;
                const r = Math.min(w, h) / 2;
                this.roundedRect(ctx, x, y, w, h, r);
                ctx.fill();
            }
        }
    }
    static async drawLogo(ctx, size, logo, theme, loadImage) {
        if (!logo)
            return;
        const logoSize = size * (logo.size || 0.2);
        const logoX = (size - logoSize) / 2;
        const logoY = (size - logoSize) / 2;
        try {
            const logoImage = await loadImage(logo.src);
            if (logo.background) {
                ctx.fillStyle = logo.background;
                const borderRadius = logo.borderRadius || logoSize * 0.1;
                this.roundedRect(ctx, logoX, logoY, logoSize, logoSize, borderRadius);
                ctx.fill();
            }
            ctx.save();
            const borderRadius = logo.borderRadius || logoSize * 0.1;
            this.roundedRect(ctx, logoX, logoY, logoSize, logoSize, borderRadius);
            ctx.clip();
            ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
            ctx.restore();
        }
        catch (error) {
            console.warn('Failed to load logo:', error);
        }
    }
    static applyThemeEffects(ctx, size, theme, themeConfig) {
        switch (theme) {
            case 'ironman': {
                const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                gradient.addColorStop(0, 'rgba(255, 215, 0, 0.1)');
                gradient.addColorStop(1, 'rgba(204, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                break;
            }
        }
    }
    static roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }
    static getAvailableThemes() {
        return Object.keys(THEMES);
    }
    static getTheme(theme) {
        return THEMES[theme] || THEMES.default;
    }
    static async generateSet(data, baseOptions = {}) {
        const sizes = [128, 256, 512, 1024];
        const formats = ['png', 'svg', 'webp'];
        const results = await Promise.all(sizes.flatMap(s => formats.map(f => this.generate({ ...baseOptions, data, size: s, format: f }))));
        return results.reduce((acc, result, i) => {
            const s = sizes[Math.floor(i / 3)];
            const f = ['png', 'svg', 'webp'][i % 3];
            acc[`${s}x${s}_${f}`] = result;
            return acc;
        }, {});
    }
}
exports.QRCodeGenerator = QRCodeGenerator;
//# sourceMappingURL=qr-generator.js.map