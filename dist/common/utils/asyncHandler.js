"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = void 0;
/**
 * Wraps async route handlers so rejected promises reach the Express error
 * middleware instead of becoming unhandled rejections.
 */
const asyncHandler = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
exports.asyncHandler = asyncHandler;
//# sourceMappingURL=asyncHandler.js.map