"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const support_service_1 = require("./support.service");
exports.supportRouter = (0, express_1.Router)();
exports.supportRouter.use(auth_1.authenticate);
exports.supportRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const tickets = await support_service_1.supportService.listSupportTickets({
        userId: req.user?.id,
    });
    res.json({ data: tickets });
}));
exports.supportRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const ticket = await support_service_1.supportService.createSupportTicket({
        userId: req.user.id,
        ...req.body,
    });
    res.status(201).json({ data: ticket });
}));
exports.supportRouter.patch("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const ticket = await support_service_1.supportService.updateTicket({
        id: req.params.id,
        data: req.body,
    });
    res.json({ data: ticket });
}));
//# sourceMappingURL=support.routes.js.map