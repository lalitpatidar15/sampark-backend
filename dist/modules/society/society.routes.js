"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.societyRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const society_service_1 = require("./society.service");
exports.societyRouter = (0, express_1.Router)();
exports.societyRouter.use(auth_1.authenticate);
exports.societyRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const societies = await society_service_1.societyService.listSocieties();
    res.json({ data: societies });
}));
exports.societyRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const society = await society_service_1.societyService.createSociety(req.body);
    res.status(201).json({ data: society });
}));
exports.societyRouter.get("/residents", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const residents = await society_service_1.societyService.listResidents(req.query);
    res.json({ data: residents });
}));
//# sourceMappingURL=society.routes.js.map