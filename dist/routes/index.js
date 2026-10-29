"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = void 0;
const express_1 = require("express");
const auth_routes_1 = require("../modules/auth/auth.routes");
const user_routes_1 = require("../modules/users/user.routes");
const tag_routes_1 = require("../modules/tags/tag.routes");
const vehicle_routes_1 = require("../modules/vehicles/vehicle.routes");
const emergency_routes_1 = require("../modules/emergency/emergency.routes");
const communication_routes_1 = require("../modules/communication/communication.routes");
const video_routes_1 = require("../modules/communication/video/video.routes");
const scanner_routes_1 = require("../modules/scanner/scanner.routes");
const location_routes_1 = require("../modules/location/location.routes");
const admin_routes_1 = require("../modules/admin/admin.routes");
const webhook_routes_1 = require("../modules/communication/webhook.routes");
const document_routes_1 = require("../modules/documents/document.routes");
const reminder_routes_1 = require("../modules/reminders/reminder.routes");
const qr_size_routes_1 = require("../modules/qr-sizes/qr-size.routes");
const mfa_routes_1 = require("../modules/mfa/mfa.routes");
const nfc_routes_1 = require("../modules/nfc/nfc.routes");
const geofence_routes_1 = require("../modules/geofence/geofence.routes");
const etag_routes_1 = require("../modules/tags/etag.routes");
const store_routes_1 = require("../modules/store/store.routes");
const analytics_routes_1 = require("../modules/analytics/analytics.routes");
const assets_routes_1 = require("../modules/assets/assets.routes");
const device_routes_1 = require("../modules/devices/device.routes");
const family_routes_1 = require("../modules/family/family.routes");
const fraud_routes_1 = require("../modules/fraud/fraud.routes");
const society_routes_1 = require("../modules/society/society.routes");
const subscription_routes_1 = require("../modules/subscriptions/subscription.routes");
const support_routes_1 = require("../modules/support/support.routes");
/**
 * Route map. Two trust zones:
 *
 *   PUBLIC  — no owner account required (scanner, webhooks, share links).
 *             Every endpoint here is rate limited and audited.
 *   OWNER   — requires a verified access token; authorization is enforced
 *             server-side, never by hiding UI in a frontend.
 */
const registerRoutes = () => {
    const router = (0, express_1.Router)();
    // --- Owner-authenticated ---
    router.use("/auth", auth_routes_1.authRouter);
    router.use("/users", user_routes_1.userRouter);
    router.use("/tags", tag_routes_1.tagRouter);
    router.use("/tags", nfc_routes_1.nfcOwnerRouter);
    router.use("/tags", geofence_routes_1.geofenceOwnerRouter);
    router.use("/tags", etag_routes_1.etagRouter);
    router.use("/vehicles", vehicle_routes_1.vehicleRouter);
    router.use("/emergency", emergency_routes_1.emergencyRouter);
    router.use("/location", location_routes_1.locationRouter);
    router.use("/communications", communication_routes_1.communicationRouter);
    router.use("/video", video_routes_1.videoRouter);
    router.use("/documents", document_routes_1.documentRouter);
    router.use("/reminders", reminder_routes_1.reminderRouter);
    router.use("/qr-sizes", qr_size_routes_1.qrSizeRouter);
    router.use("/auth/mfa", mfa_routes_1.mfaRouter);
    router.use("/admin", admin_routes_1.adminRouter);
    router.use("/analytics", analytics_routes_1.analyticsRouter);
    router.use("/assets", assets_routes_1.assetsRouter);
    router.use("/devices", device_routes_1.deviceRouter);
    router.use("/family", family_routes_1.familyRouter);
    router.use("/fraud", fraud_routes_1.fraudRouter);
    router.use("/society", society_routes_1.societyRouter);
    router.use("/subscriptions", subscription_routes_1.subscriptionRouter);
    router.use("/support", support_routes_1.supportRouter);
    // --- Public: privacy gateway ---
    router.use("/s", scanner_routes_1.scannerRouter);
    router.use("/s/chat", communication_routes_1.scannerChatRouter);
    router.use("/s/location", location_routes_1.scannerLocationRouter);
    router.use("/s/nfc", nfc_routes_1.nfcPublicRouter);
    router.use("/s/geofence", geofence_routes_1.geofencePublicRouter);
    router.use("/location-share", location_routes_1.publicLocationRouter);
    // --- Store / tag sales ---
    router.use("/", store_routes_1.storeRouter);
    // --- Public: provider webhooks ---
    router.use("/webhooks", webhook_routes_1.webhookRouter);
    return router;
};
exports.registerRoutes = registerRoutes;
//# sourceMappingURL=index.js.map