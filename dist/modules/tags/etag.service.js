"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagService = void 0;
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const providers_1 = require("../../providers");
const qr_generator_1 = require("../qr/qr-generator");
const log = (0, logger_1.childLogger)("etag");
exports.etagService = {
    async generateETagHTML(input) {
        const { brandName, tagLine, qrCodeDataUrl, publicToken, assetInfo, instructions } = input;
        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} eTag</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; min-height: 100vh; padding: 20px; }
    .card { max-width: 400px; margin: 0 auto; background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: white; padding: 32px 24px; text-align: center; }
    .logo { width: 64px; height: 64px; background: rgba(255,255,255,0.2); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 24px; font-weight: 700; }
    .brand { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .tagline { font-size: 14px; opacity: 0.9; }
    .content { padding: 24px; }
    .qr-container { text-align: center; margin-bottom: 24px; }
    .qr-code { width: 200px; height: 200px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
    .token { font-family: monospace; font-size: 12px; color: #64748b; background: #f1f5f9; padding: 8px 12px; border-radius: 8px; display: inline-block; margin-top: 12px; word-break: break-all; }
    .asset-info { background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
    .asset-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .asset-row:last-child { border-bottom: none; }
    .asset-label { color: #64748b; font-size: 13px; }
    .asset-value { font-weight: 600; color: #0f172a; font-size: 13px; }
    .instructions { font-size: 13px; color: #475569; line-height: 1.6; }
    .instructions h3 { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin-bottom: 8px; }
    .footer { text-align: center; padding: 20px 24px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; }
    .download-btn { display: inline-block; background: #0ea5e9; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">S</div>
      <div class="brand">${brandName}</div>
      <div class="tagline">${tagLine}</div>
    </div>
    <div class="content">
      <div class="qr-container">
        <img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code" />
        <div class="token">${publicToken}</div>
      </div>
      ${assetInfo ? `
      <div class="asset-info">
        <div class="asset-row"><span class="asset-label">Type</span><span class="asset-value">${assetInfo.type}</span></div>
        <div class="asset-row"><span class="asset-label">Name</span><span class="asset-value">${assetInfo.displayName}</span></div>
        ${assetInfo.make ? `<div class="asset-row"><span class="asset-label">Make</span><span class="asset-value">${assetInfo.make}</span></div>` : ""}
        ${assetInfo.model ? `<div class="asset-row"><span class="asset-label">Model</span><span class="asset-value">${assetInfo.model}</span></div>` : ""}
        ${assetInfo.color ? `<div class="asset-row"><span class="asset-label">Color</span><span class="asset-value">${assetInfo.color}</span></div>` : ""}
        ${assetInfo.registrationEnding ? `<div class="asset-row"><span class="asset-label">Reg. Ending</span><span class="asset-value">${assetInfo.registrationEnding}</span></div>` : ""}
      </div>
      ` : ""}
      <div class="instructions">
        <h3>How to use this eTag</h3>
        <ol>
          ${instructions.map(i => `<li>${i}</li>`).join("")}
        </ol>
      </div>
    </div>
    <div class="footer">
      <p>Powered by ${brandName} — Privacy-preserving contact platform</p>
      <p>Your phone number and identity are never shared with anyone who scans this tag.</p>
    </div>
  </div>
</body>
</html>
    `;
    },
    async generateETagForOwner(input) {
        const tag = await prisma_1.prisma.tag.findUnique({
            where: { id: input.tagId },
            include: { asset: { include: { vehicle: true } }, owner: true },
        });
        if (!tag || tag.ownerId !== input.ownerId) {
            throw new Error("Tag not found");
        }
        const publicToken = (0, crypto_1.decryptField)(tag.publicTokenEncrypted, "tag_token");
        const qrPayload = `${config_1.env.WEB_BASE_URL.replace(/\/$/, "")}/t/${publicToken}`;
        const assetInfo = tag.asset ? {
            type: tag.asset.assetType,
            displayName: tag.asset.displayName,
            make: tag.asset.vehicle?.make || undefined,
            model: tag.asset.vehicle?.model || undefined,
            color: tag.asset.vehicle?.color || undefined,
            registrationEnding: tag.asset.vehicle?.registrationEnding || undefined,
        } : undefined;
        const qrCodeDataUrl = await this.generateQRCodeDataUrl(qrPayload);
        const eTagData = {
            brandName: config_1.env.APP_NAME,
            tagLine: "Privacy-preserving contact platform",
            qrCodeDataUrl,
            publicToken,
            assetInfo,
            instructions: [
                "Save this eTag as an image or PDF",
                "Set as phone wallpaper for quick access",
                "Share via WhatsApp, Email, or AirDrop",
                "Anyone who scans can contact you privately",
                "Your phone number is never revealed",
            ],
        };
        const html = await this.generateETagHTML(eTagData);
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "etag.generate",
            resourceType: "tag",
            resourceId: input.tagId,
            ip: input.ip,
            metadata: { format: input.format },
        });
        return { html, qrCodeDataUrl, publicToken };
    },
    async generateQRCodeDataUrl(text) {
        const qr = await qr_generator_1.QRCodeGenerator.generate({ data: text, size: 300, format: 'png', errorCorrectionLevel: 'M' });
        return qr.dataUrl;
    },
    async sendETagViaEmail(input) {
        const { html } = await this.generateETagForOwner({ ownerId: input.ownerId, tagId: input.tagId, format: "html", ip: input.ip });
        await providers_1.emailProvider.send({
            to: input.email,
            subject: `Your ${config_1.env.APP_NAME} eTag`,
            html,
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "etag.email_sent",
            resourceType: "tag",
            resourceId: input.tagId,
            ip: input.ip,
        });
    },
    async sendETagViaWhatsApp(input) {
        const { html } = await this.generateETagForOwner({ ownerId: input.ownerId, tagId: input.tagId, format: "html", ip: input.ip });
        await Promise.resolve().then(() => __importStar(require("../../providers"))).then(({ whatsappProvider }) => {
            return whatsappProvider.send({
                to: input.phone,
                body: html,
                mode: "NOTIFICATION",
                templateName: "etag_delivery",
            });
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.ownerId,
            action: "etag.whatsapp_sent",
            resourceType: "tag",
            resourceId: input.tagId,
            ip: input.ip,
        });
    },
};
//# sourceMappingURL=etag.service.js.map