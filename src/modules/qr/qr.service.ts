import QRCode from "qrcode";
import { env } from "../../config";
import { forbidden } from "../../common/errors";
import { tagService } from "../tags/tag.service";

export interface QrRenderInput {
  tagId: string;
  ownerId: string;
  format?: string;
  size?: number;
}

/**
 * Digital eTag rendering (spec 19).
 *
 * The QR encodes only `https://<web>/t/<opaque token>` — no phone number, no
 * name, no address, no emergency contact, no vehicle document detail.
 */
export const buildQrPayload = async (input: QrRenderInput): Promise<Buffer | string> => {
  const publicToken = await tagService.publicTokenForOwner(input.tagId, input.ownerId);
  return renderQr(tagService.qrPayloadFor(publicToken), input);
};

export const renderQr = async (data: string, input: QrRenderInput): Promise<Buffer | string> => {
  const size = input.size ?? 512;
  if (input.format === "svg") {
    return QRCode.toString(data, { type: "svg", width: size, margin: 2, errorCorrectionLevel: "M" });
  }
  return QRCode.toBuffer(data, { type: "png", width: size, margin: 2, errorCorrectionLevel: "M" });
};

/**
 * Printable eTag card as an HTML document. Deliberately free of any owner
 * private field — only brand, QR, public code and instructions.
 */
export const buildETagHtml = (input: {
  publicTagId: string;
  qrDataUrl: string;
  displayName: string | null;
  instructions: string[];
}): string => {
  const escape = (value: string): string =>
    value.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
    );

  const list = input.instructions
    .map((line) => `<li>${escape(line)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(env.APP_NAME)} eTag</title>
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
    <div class="brand">${escape(env.APP_NAME)}</div>
    ${input.displayName ? `<div class="display">${escape(input.displayName)}</div>` : ""}
    <img src="${input.qrDataUrl}" alt="Contact QR code" width="260" height="260" />
    <div class="code">${escape(input.publicTagId)}</div>
    <ol>${list}</ol>
    <div class="footer">No app required. Scan with any phone camera.</div>
  </div>
</body>
</html>`;
};

export const assertOwnerCanRender = async (tagId: string, ownerId: string): Promise<void> => {
  try {
    await tagService.publicTokenForOwner(tagId, ownerId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("own this tag")) throw forbidden("Not your tag");
    throw error;
  }
};
