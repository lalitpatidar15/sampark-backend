import { prisma } from "../../db/prisma";
import { notFound, forbidden } from "../../common/errors";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";

const log = childLogger("reminders");

export const reminderService = {
  async listReminders(userId: string) {
    return prisma.reminder.findMany({
      where: { userId },
      orderBy: { dueAt: "asc" },
      include: { vehicle: { select: { id: true, make: true, model: true, registrationEnding: true } } },
    });
  },

  async getReminder(userId: string, reminderId: string) {
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: { vehicle: { select: { id: true, make: true, model: true, registrationEnding: true } } },
    });
    if (!reminder) throw notFound("Reminder not found");
    if (reminder.userId !== userId) throw forbidden("Not your reminder");
    return reminder;
  },

  async createReminder(input: {
    userId: string;
    vehicleId?: string;
    reminderType: string;
    title: string;
    dueAt: Date;
    ip?: string;
  }) {
    if (input.vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!vehicle) throw notFound("Vehicle not found");
      if (vehicle.ownerId !== input.userId) throw forbidden("Not your vehicle");
    }

    const reminder = await prisma.reminder.create({
      data: {
        userId: input.userId,
        vehicleId: input.vehicleId,
        reminderType: input.reminderType,
        title: input.title,
        dueAt: input.dueAt,
        status: "PENDING",
      },
    });

    await audit({
      actorUserId: input.userId,
      action: "reminder.create",
      resourceType: "reminder",
      resourceId: reminder.id,
      ip: input.ip,
      metadata: { reminderType: input.reminderType, dueAt: input.dueAt.toISOString() },
    });

    log.info({ reminderId: reminder.id, userId: input.userId }, "reminder created");
    return reminder;
  },

  async updateReminder(input: {
    userId: string;
    reminderId: string;
    patch: Partial<{ title: string; dueAt: Date; status: string }>;
    ip?: string;
  }) {
    const reminder = await prisma.reminder.findUnique({ where: { id: input.reminderId } });
    if (!reminder) throw notFound("Reminder not found");
    if (reminder.userId !== input.userId) throw forbidden("Not your reminder");

    const updated = await prisma.reminder.update({
      where: { id: input.reminderId },
      data: input.patch,
    });

    await audit({
      actorUserId: input.userId,
      action: "reminder.update",
      resourceType: "reminder",
      resourceId: input.reminderId,
      ip: input.ip,
      metadata: { fields: Object.keys(input.patch) },
    });

    return updated;
  },

  async deleteReminder(userId: string, reminderId: string, ip?: string) {
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) throw notFound("Reminder not found");
    if (reminder.userId !== userId) throw forbidden("Not your reminder");

    await prisma.reminder.delete({ where: { id: reminderId } });
    await audit({
      actorUserId: userId,
      action: "reminder.delete",
      resourceType: "reminder",
      resourceId: reminderId,
      ip,
    });
  },

  async markSent(reminderId: string) {
    return prisma.reminder.update({
      where: { id: reminderId },
      data: { status: "SENT", sentAt: new Date() },
    });
  },
};