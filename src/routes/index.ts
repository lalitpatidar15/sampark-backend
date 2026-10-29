import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes";
import { userRouter } from "../modules/users/user.routes";
import { tagRouter } from "../modules/tags/tag.routes";
import { vehicleRouter } from "../modules/vehicles/vehicle.routes";
import { emergencyRouter } from "../modules/emergency/emergency.routes";
import { communicationRouter, scannerChatRouter } from "../modules/communication/communication.routes";
import { videoRouter } from "../modules/communication/video/video.routes";
import { scannerRouter } from "../modules/scanner/scanner.routes";
import { locationRouter, publicLocationRouter, scannerLocationRouter } from "../modules/location/location.routes";
import { adminRouter } from "../modules/admin/admin.routes";
import { webhookRouter } from "../modules/communication/webhook.routes";
import { documentRouter } from "../modules/documents/document.routes";
import { reminderRouter } from "../modules/reminders/reminder.routes";
import { qrSizeRouter } from "../modules/qr-sizes/qr-size.routes";
import { mfaRouter } from "../modules/mfa/mfa.routes";
import { nfcOwnerRouter, nfcPublicRouter } from "../modules/nfc/nfc.routes";
import { geofenceOwnerRouter, geofencePublicRouter } from "../modules/geofence/geofence.routes";
import { etagRouter } from "../modules/tags/etag.routes";
import { storeRouter } from "../modules/store/store.routes";
import { analyticsRouter } from "../modules/analytics/analytics.routes";
import { assetsRouter } from "../modules/assets/assets.routes";
import { deviceRouter } from "../modules/devices/device.routes";
import { familyRouter } from "../modules/family/family.routes";
import { fraudRouter } from "../modules/fraud/fraud.routes";
import { societyRouter } from "../modules/society/society.routes";
import { subscriptionRouter } from "../modules/subscriptions/subscription.routes";
import { supportRouter } from "../modules/support/support.routes";

/**
 * Route map. Two trust zones:
 *
 *   PUBLIC  — no owner account required (scanner, webhooks, share links).
 *             Every endpoint here is rate limited and audited.
 *   OWNER   — requires a verified access token; authorization is enforced
 *             server-side, never by hiding UI in a frontend.
 */
export const registerRoutes = (): Router => {
  const router = Router();

  // --- Owner-authenticated ---
  router.use("/auth", authRouter);
  router.use("/users", userRouter);
  router.use("/tags", tagRouter);
  router.use("/tags", nfcOwnerRouter);
  router.use("/tags", geofenceOwnerRouter);
  router.use("/tags", etagRouter);
  router.use("/vehicles", vehicleRouter);
  router.use("/emergency", emergencyRouter);
  router.use("/location", locationRouter);
  router.use("/communications", communicationRouter);
  router.use("/video", videoRouter);
  router.use("/documents", documentRouter);
  router.use("/reminders", reminderRouter);
  router.use("/qr-sizes", qrSizeRouter);
  router.use("/auth/mfa", mfaRouter);
  router.use("/admin", adminRouter);
  router.use("/analytics", analyticsRouter);
  router.use("/assets", assetsRouter);
  router.use("/devices", deviceRouter);
  router.use("/family", familyRouter);
  router.use("/fraud", fraudRouter);
  router.use("/society", societyRouter);
  router.use("/subscriptions", subscriptionRouter);
  router.use("/support", supportRouter);

  // --- Public: privacy gateway ---
  router.use("/s", scannerRouter);
  router.use("/s/chat", scannerChatRouter);
  router.use("/s/location", scannerLocationRouter);
  router.use("/s/nfc", nfcPublicRouter);
  router.use("/s/geofence", geofencePublicRouter);
  router.use("/location-share", publicLocationRouter);

  // --- Store / tag sales ---
  router.use("/", storeRouter);

  // --- Public: provider webhooks ---
  router.use("/webhooks", webhookRouter);

  return router;
};
