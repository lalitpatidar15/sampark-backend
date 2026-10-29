"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reminderRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../common/middleware/auth");
const validation_1 = require("../../common/validation");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const permissions_1 = require("../../common/guards/permissions");
const reminder_service_1 = require("./reminder.service");
const createReminderSchema = zod_1.z.object({
    vehicleId: zod_1.z.string().uuid().optional(),
    reminderType: zod_1.z.enum(["PUC_EXPIRY", "INSURANCE_EXPIRY", "FASTAG_ISSUE", "SERVICE_DUE", "CUSTOM"]),
    title: zod_1.z.string().min(1).max(100),
    dueAt: zod_1.z.string().datetime(),
});
const updateReminderSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(100).optional(),
    dueAt: zod_1.z.string().datetime().optional(),
    status: zod_1.z.enum(["PENDING", "QUEUED", "SENT", "DISMISSED"]).optional(),
});
const reminderIdSchema = zod_1.z.object({ reminderId: zod_1.z.string().uuid() });
exports.reminderRouter = (0, express_1.Router)();
exports.reminderRouter.use(auth_1.authenticate);
exports.reminderRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: await reminder_service_1.reminderService.listReminders(req.user.id) });
}));
exports.reminderRouter.get("/:reminderId", (0, validation_1.validate)(reminderIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { reminderId } = req.params;
    res.json({ data: await reminder_service_1.reminderService.getReminder(req.user.id, reminderId) });
}));
exports.reminderRouter.post("/", (0, auth_1.requirePermission)(permissions_1.Permission.REMINDERS_MANAGE), (0, validation_1.validate)(createReminderSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await reminder_service_1.reminderService.createReminder({
        ...req.body,
        userId: req.user.id,
        dueAt: new Date(req.body.dueAt),
        ip: req.ip,
    });
    res.status(201).json({ data: result });
}));
exports.reminderRouter.patch("/:reminderId", (0, auth_1.requirePermission)(permissions_1.Permission.REMINDERS_MANAGE), (0, validation_1.validate)(updateReminderSchema), (0, validation_1.validate)(reminderIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { reminderId } = req.params;
    const patch = { ...req.body };
    if (patch.dueAt)
        patch.dueAt = new Date(patch.dueAt);
    res.json({ data: await reminder_service_1.reminderService.updateReminder({ userId: req.user.id, reminderId, patch, ip: req.ip }) });
}));
exports.reminderRouter.delete("/:reminderId", (0, auth_1.requirePermission)(permissions_1.Permission.REMINDERS_MANAGE), (0, validation_1.validate)(reminderIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { reminderId } = req.params;
    await reminder_service_1.reminderService.deleteReminder(req.user.id, reminderId, req.ip);
    res.status(204).send();
}));
exports.reminderRouter.post("/:reminderId/mark-sent", (0, validation_1.validate)(reminderIdSchema, "params"), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { reminderId } = req.params;
    res.json({ data: await reminder_service_1.reminderService.markSent(reminderId) });
}));
//# sourceMappingURL=reminder.routes.js.map