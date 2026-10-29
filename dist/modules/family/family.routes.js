"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.familyRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const family_service_1 = require("./family.service");
exports.familyRouter = (0, express_1.Router)();
exports.familyRouter.use(auth_1.authenticate);
exports.familyRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const members = await family_service_1.familyService.listFamilyMembers({
        ownerId: req.user?.id,
    });
    res.json({ data: members });
}));
exports.familyRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const member = await family_service_1.familyService.createFamilyMember({
        ownerId: req.user.id,
        ...req.body,
    });
    res.status(201).json({ data: member });
}));
exports.familyRouter.patch("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const member = await family_service_1.familyService.updateFamilyMember({
        id: req.params.id,
        data: req.body,
    });
    res.json({ data: member });
}));
exports.familyRouter.delete("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await family_service_1.familyService.deleteFamilyMember({ id: req.params.id });
    res.status(204).send();
}));
//# sourceMappingURL=family.routes.js.map