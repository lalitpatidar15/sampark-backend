"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fraudRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const fraud_service_1 = require("./fraud.service");
exports.fraudRouter = (0, express_1.Router)();
exports.fraudRouter.use(auth_1.authenticate);
exports.fraudRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const reports = await fraud_service_1.fraudService.listAbuseReports({});
    res.json({ data: reports });
}));
exports.fraudRouter.post("/:id/review", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const report = await fraud_service_1.fraudService.reviewReport({
        reportId: req.params.id,
        state: req.body.state,
        actionTaken: req.body.actionTaken,
    });
    res.json({ data: report });
}));
exports.fraudRouter.post("/auto-suspend", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await fraud_service_1.fraudService.autoSuspendTags();
    res.json({ data: result });
}));
//# sourceMappingURL=fraud.routes.js.map