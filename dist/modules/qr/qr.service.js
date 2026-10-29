"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertOwnerCanRender = exports.buildETagHtml = exports.renderQr = exports.buildQrPayload = void 0;
const qrcode_1 = __importDefault(require("qrcode"));
const config_1 = require("../../config");
const errors_1 = require("../../common/errors");
const tag_service_1 = require("../tags/tag.service");
/**
 * Digital eTag rendering (spec 19).
 *
 * The QR encodes only `https://<web>/t/<opaque token>` — no phone number, no
 * name, no address, no emergency contact, no vehicle document detail.
 */
const buildQrPayload = async (input) => {
    const publicToken = await tag_service_1.tagService.publicTokenForOwner(input.tagId, input.ownerId);
    return (0, exports.renderQr)(tag_service_1.tagService.qrPayloadFor(publicToken), input);
};
exports.buildQrPayload = buildQrPayload;
const renderQr = async (data, input) => {
    const size = input.size ?? 512;
    if (input.format === "svg") {
        return qrcode_1.default.toString(data, { type: "svg", width: size, margin: 2, errorCorrectionLevel: "M" });
    }
    return qrcode_1.default.toBuffer(data, { type: "png", width: size, margin: 2, errorCorrectionLevel: "M" });
};
exports.renderQr = renderQr;
/**
 * Printable eTag card as an HTML document. Deliberately free of any owner
 * private field — only brand, QR, public code and instructions.
 */
const buildETagHtml = (input) => {
    const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const list = input.instructions
        .map((line) => `<li>${escape(line)}</li>`)
        .join("");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(config_1.env.APP_NAME)} eTag</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:32px;background:#f6f7f9;color:#111}
  .card{max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 16px rgba(0,0,0,.08);text-align:center}
  .brand{font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:13px;color:#666}
  .code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all;color:#444;margin:8px 0 20px}
  .display{font-size:18px;font-weight:600;margin-bottom:16px}
  ol{text-align:left;padding-left:20px;color:#333;line-height:1.6;font-size:14px}
  .footer{margin-top:20px;font-size:11px;color:#888}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">${escape(config_1.env.APP_NAME)}</div>
    ${input.displayName ? `<div class="display">${escape(input.displayName)}</div>` : ""}
    <img src="${input.qrDataUrl}" alt="Contact QR code" width="260" height="260" />
    <div class="code">${escape(input.publicTagId)}</div>
    <ol>${list}</ol>
    <div class="footer">No app required. Scan with any phone camera.</div>
  </div>
</body>
</html>`;
};
exports.buildETagHtml = buildETagHtml;
const assertOwnerCanRender = async (tagId, ownerId) => {
    try {
        await tag_service_1.tagService.publicTokenForOwner(tagId, ownerId);
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("own this tag"))
            throw (0, errors_1.forbidden)("Not your tag");
        throw error;
    }
};
exports.assertOwnerCanRender = assertOwnerCanRender;
//# sourceMappingURL=qr.service.js.map