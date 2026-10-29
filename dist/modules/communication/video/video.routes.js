"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../../common/middleware/auth");
const validation_1 = require("../../../common/validation");
const asyncHandler_1 = require("../../../common/utils/asyncHandler");
const video_service_1 = require("./video.service");
const createVideoSchema = zod_1.z.object({
    scannerSessionId: zod_1.z.string().uuid(),
    reasonCode: zod_1.z.string().min(1),
});
const joinRoomSchema = zod_1.z.object({
    roomId: zod_1.z.string().min(1),
    roomToken: zod_1.z.string().min(1),
});
exports.videoRouter = (0, express_1.Router)();
exports.videoRouter.post("/create", auth_1.authenticate, (0, validation_1.validate)(createVideoSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { scannerSessionId, reasonCode } = req.body;
    const result = await video_service_1.videoService.createVideoSession({
        scannerSessionId,
        ownerId: req.user.id,
        tagId: req.body.tagId, // This should come from the scanner session
        reasonCode,
        ip: req.ip,
    });
    res.json({ data: result });
}));
exports.videoRouter.post("/join", (0, validation_1.validate)(joinRoomSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { roomId, roomToken } = req.body;
    const isOwner = Boolean(req.headers["x-owner-token"]);
    const userId = isOwner ? req.headers["x-user-id"] : req.headers["x-scanner-session"];
    if (!userId) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing identity" } });
    }
    const result = await video_service_1.videoService.joinRoom({ roomId, roomToken, userId, isOwner });
    res.json({ data: result });
}));
exports.videoRouter.post("/leave", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { roomId } = req.body;
    const userId = req.headers["x-user-id"] || req.headers["x-scanner-session"];
    if (!userId) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing identity" } });
    }
    await video_service_1.videoService.leaveRoom({ roomId, userId });
    res.status(204).send();
}));
//# sourceMappingURL=video.routes.js.map