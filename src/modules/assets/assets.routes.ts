import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { assetService } from "./assets.service";

export const assetsRouter = Router();

assetsRouter.use(authenticate);

assetsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const assets = await assetService.listAssets({
      ownerId: req.user?.id,
    });
    res.json({ data: assets });
  }),
);

assetsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const asset = await assetService.createAsset({
      ownerId: req.user!.id,
      ...req.body,
    });
    res.status(201).json({ data: asset });
  }),
);

assetsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const asset = await assetService.updateAsset({
      id: req.params.id,
      ownerId: req.user!.id,
      data: req.body,
    });
    res.json({ data: asset });
  }),
);

assetsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assetService.deleteAsset({ id: req.params.id });
    res.status(204).send();
  }),
);
