"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minutesBetween = exports.isExpired = exports.addDays = exports.addHours = exports.addMinutes = exports.addSeconds = exports.now = void 0;
const now = () => new Date();
exports.now = now;
const addSeconds = (seconds, from = new Date()) => new Date(from.getTime() + seconds * 1000);
exports.addSeconds = addSeconds;
const addMinutes = (minutes, from = new Date()) => new Date(from.getTime() + minutes * 60 * 1000);
exports.addMinutes = addMinutes;
const addHours = (hours, from = new Date()) => new Date(from.getTime() + hours * 60 * 60 * 1000);
exports.addHours = addHours;
const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
exports.addDays = addDays;
const isExpired = (date) => !!date && date.getTime() <= Date.now();
exports.isExpired = isExpired;
const minutesBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 60_000);
exports.minutesBetween = minutesBetween;
//# sourceMappingURL=time.js.map