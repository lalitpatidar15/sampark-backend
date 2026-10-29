"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMeta = exports.paginated = exports.parsePagination = void 0;
const parsePagination = (query) => {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const rawLimit = Number(query.limit ?? 20) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    return { page, limit, skip: (page - 1) * limit };
};
exports.parsePagination = parsePagination;
const paginated = (items, total, { page, limit }) => ({
    items,
    meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
    },
});
exports.paginated = paginated;
const buildMeta = (total, { page, limit }) => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
});
exports.buildMeta = buildMeta;
//# sourceMappingURL=pagination.js.map