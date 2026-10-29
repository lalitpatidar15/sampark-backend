"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const subscription_service_1 = require("./subscription.service");
exports.subscriptionRouter = (0, express_1.Router)();
exports.subscriptionRouter.use(auth_1.authenticate);
exports.subscriptionRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const subs = await subscription_service_1.subscriptionService.listSubscriptions({
        userId: req.user?.id,
    });
    res.json({ data: subs });
}));
exports.subscriptionRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const sub = await subscription_service_1.subscriptionService.createSubscription({
        userId: req.user.id,
        ...req.body,
    });
    res.status(201).json({ data: sub });
}));
exports.subscriptionRouter.patch("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const sub = await subscription_service_1.subscriptionService.updateSubscription({
        id: req.params.id,
        data: req.body,
    });
    res.json({ data: sub });
}));
exports.subscriptionRouter.post("/:id/cancel", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const sub = await subscription_service_1.subscriptionService.cancelSubscription({
        id: req.params.id,
    });
    res.json({ data: sub });
}));
//# sourceMappingURL=subscription.routes.js.map