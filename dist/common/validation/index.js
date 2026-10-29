"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const errors_1 = require("../errors");
const validate = (schema, source = "body") => {
    return (req, _res, next) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) {
            return next((0, errors_1.validationError)("Request validation failed", formatZodError(result.error)));
        }
        if (source === "body") {
            req.body = result.data;
        }
        else {
            // req.query / req.params are getter-only in Express 5, so the coerced
            // value is exposed on a namespaced property instead of being reassigned.
            Object.defineProperty(req, `validated${source}`, { value: result.data, configurable: true });
        }
        return next();
    };
};
exports.validate = validate;
const formatZodError = (error) => error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
//# sourceMappingURL=index.js.map