"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../../common/middleware/auth");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const assets_service_1 = require("./assets.service");
exports.assetsRouter = (0, express_1.Router)();
exports.assetsRouter.use(auth_1.authenticate);
exports.assetsRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const assets = await assets_service_1.assetService.listAssets({
        ownerId: req.user?.id,
    });
    res.json({ data: assets });
}));
exports.assetsRouter.post("/", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const asset = await assets_service_1.assetService.createAsset({
        ownerId: req.user.id,
        ...req.body,
    });
    res.status(201).json({ data: asset });
}));
exports.assetsRouter.patch("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const asset = await assets_service_1.assetService.updateAsset({
        id: req.params.id,
        ownerId: req.user.id,
        data: req.body,
    });
    res.json({ data: asset });
}));
exports.assetsRouter.delete("/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await assets_service_1.assetService.deleteAsset({ id: req.params.id });
    res.status(204).send();
}));
//# sourceMappingURL=assets.routes.js.map