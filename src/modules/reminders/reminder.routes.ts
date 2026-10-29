import { Router } from "express";
import { z } from "zod";
import { authenticate, requirePermission } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { Permission } from "../../common/guards/permissions";
import { reminderService } from "./reminder.service";

const createReminderSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  reminderType: z.enum(["PUC_EXPIRY", "INSURANCE_EXPIRY", "FASTAG_ISSUE", "SERVICE_DUE", "CUSTOM"]),
  title: z.string().min(1).max(100),
  dueAt: z.string().datetime(),
});

const updateReminderSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  dueAt: z.string().datetime().optional(),
  status: z.enum(["PENDING", "QUEUED", "SENT", "DISMISSED"]).optional(),
});

const reminderIdSchema = z.object({ reminderId: z.string().uuid() });

export const reminderRouter = Router();

reminderRouter.use(authenticate);

reminderRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await reminderService.listReminders(req.user!.id) });
  }),
);

reminderRouter.get(
  "/:reminderId",
  validate(reminderIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { reminderId } = req.params as unknown as z.infer<typeof reminderIdSchema>;
    res.json({ data: await reminderService.getReminder(req.user!.id, reminderId) });
  }),
);

reminderRouter.post(
  "/",
  requirePermission(Permission.REMINDERS_MANAGE),
  validate(createReminderSchema),
  asyncHandler(async (req, res) => {
    const result = await reminderService.createReminder({
      ...req.body,
      userId: req.user!.id,
      dueAt: new Date(req.body.dueAt),
      ip: req.ip,
    });
    res.status(201).json({ data: result });
  }),
);

reminderRouter.patch(
  "/:reminderId",
  requirePermission(Permission.REMINDERS_MANAGE),
  validate(updateReminderSchema),
  validate(reminderIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { reminderId } = req.params as unknown as z.infer<typeof reminderIdSchema>;
    const patch = { ...req.body };
    if (patch.dueAt) patch.dueAt = new Date(patch.dueAt);
    res.json({ data: await reminderService.updateReminder({ userId: req.user!.id, reminderId, patch, ip: req.ip }) });
  }),
);

reminderRouter.delete(
  "/:reminderId",
  requirePermission(Permission.REMINDERS_MANAGE),
  validate(reminderIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { reminderId } = req.params as unknown as z.infer<typeof reminderIdSchema>;
    await reminderService.deleteReminder(req.user!.id, reminderId, req.ip);
    res.status(204).send();
  }),
);

reminderRouter.post(
  "/:reminderId/mark-sent",
  validate(reminderIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { reminderId } = req.params as unknown as z.infer<typeof reminderIdSchema>;
    res.json({ data: await reminderService.markSent(reminderId) });
  }),
);