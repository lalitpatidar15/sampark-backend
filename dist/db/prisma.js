"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDatabase = exports.connectDatabase = exports.prisma = void 0;
const client_1 = require("@prisma/client");
const config_1 = require("../config");
const logger_1 = require("../common/logger");
const log = (0, logger_1.childLogger)("prisma");
exports.prisma = new client_1.PrismaClient({
    log: config_1.env.NODE_ENV === "development"
        ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
        : [{ emit: "event", level: "error" }],
});
exports.prisma.$on("warn", (e) => log.warn({ e }, "prisma warning"));
exports.prisma.$on("error", (e) => log.error({ e }, "prisma error"));
const connectDatabase = async () => {
    await exports.prisma.$connect();
    log.info("Database connected");
};
exports.connectDatabase = connectDatabase;
const disconnectDatabase = async () => {
    await exports.prisma.$disconnect();
};
exports.disconnectDatabase = disconnectDatabase;
//# sourceMappingURL=prisma.js.map