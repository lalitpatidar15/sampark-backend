"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reminderService = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../../common/errors");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const log = (0, logger_1.childLogger)("reminders");
exports.reminderService = {
    async listReminders(userId) {
        return prisma_1.prisma.reminder.findMany({
            where: { userId },
            orderBy: { dueAt: "asc" },
            include: { vehicle: { select: { id: true, make: true, model: true, registrationEnding: true } } },
        });
    },
    async getReminder(userId, reminderId) {
        const reminder = await prisma_1.prisma.reminder.findUnique({
            where: { id: reminderId },
            include: { vehicle: { select: { id: true, make: true, model: true, registrationEnding: true } } },
        });
        if (!reminder)
            throw (0, errors_1.notFound)("Reminder not found");
        if (reminder.userId !== userId)
            throw (0, errors_1.forbidden)("Not your reminder");
        return reminder;
    },
    async createReminder(input) {
        if (input.vehicleId) {
            const vehicle = await prisma_1.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
            if (!vehicle)
                throw (0, errors_1.notFound)("Vehicle not found");
            if (vehicle.ownerId !== input.userId)
                throw (0, errors_1.forbidden)("Not your vehicle");
        }
        const reminder = await prisma_1.prisma.reminder.create({
            data: {
                userId: input.userId,
                vehicleId: input.vehicleId,
                reminderType: input.reminderType,
                title: input.title,
                dueAt: input.dueAt,
                status: "PENDING",
            },
        });
        await (0, audit_service_1.audit)({
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
    async updateReminder(input) {
        const reminder = await prisma_1.prisma.reminder.findUnique({ where: { id: input.reminderId } });
        if (!reminder)
            throw (0, errors_1.notFound)("Reminder not found");
        if (reminder.userId !== input.userId)
            throw (0, errors_1.forbidden)("Not your reminder");
        const updated = await prisma_1.prisma.reminder.update({
            where: { id: input.reminderId },
            data: input.patch,
        });
        await (0, audit_service_1.audit)({
            actorUserId: input.userId,
            action: "reminder.update",
            resourceType: "reminder",
            resourceId: input.reminderId,
            ip: input.ip,
            metadata: { fields: Object.keys(input.patch) },
        });
        return updated;
    },
    async deleteReminder(userId, reminderId, ip) {
        const reminder = await prisma_1.prisma.reminder.findUnique({ where: { id: reminderId } });
        if (!reminder)
            throw (0, errors_1.notFound)("Reminder not found");
        if (reminder.userId !== userId)
            throw (0, errors_1.forbidden)("Not your reminder");
        await prisma_1.prisma.reminder.delete({ where: { id: reminderId } });
        await (0, audit_service_1.audit)({
            actorUserId: userId,
            action: "reminder.delete",
            resourceType: "reminder",
            resourceId: reminderId,
            ip,
        });
    },
    async markSent(reminderId) {
        return prisma_1.prisma.reminder.update({
            where: { id: reminderId },
            data: { status: "SENT", sentAt: new Date() },
        });
    },
};
//# sourceMappingURL=reminder.service.js.map