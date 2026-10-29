"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const analytics_service_1 = require("./analytics.service");
exports.analyticsRouter = (0, express_1.Router)();
exports.analyticsRouter.use(auth_1.authenticate);
exports.analyticsRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : 30;
    const metrics = await analytics_service_1.analyticsService.listMetrics({ days });
    res.json({ data: metrics });
}));
exports.analyticsRouter.post("/rollup", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await analytics_service_1.analyticsService.rollup({ date: req.body.date });
    res.json({ data: result });
}));
//# sourceMappingURL=analytics.routes.js.map