"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const device_service_1 = require("./device.service");
exports.deviceRouter = (0, express_1.Router)();
exports.deviceRouter.use(auth_1.authenticate);
exports.deviceRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const devices = await device_service_1.deviceService.listDevices({
        userId: req.user?.id,
    });
    res.json({ data: devices });
}));
exports.deviceRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const device = await device_service_1.deviceService.createDevice({
        userId: req.user.id,
        ...req.body,
    });
    res.status(201).json({ data: device });
}));
exports.deviceRouter.patch("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const device = await device_service_1.deviceService.updateDevice({
        id: req.params.id,
        data: req.body,
    });
    res.json({ data: device });
}));
exports.deviceRouter.delete("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await device_service_1.deviceService.deleteDevice({ id: req.params.id });
    res.status(204).send();
}));
//# sourceMappingURL=device.routes.js.map