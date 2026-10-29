import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth";
import { validate } from "../../common/validation";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { analyticsService } from "./analytics.service";

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

analyticsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : 30;
    const metrics = await analyticsService.listMetrics({ days });
    res.json({ data: metrics });
  }),
);

analyticsRouter.post(
  "/rollup",
  asyncHandler(async (req, res) => {
    const result = await analyticsService.rollup({ date: req.body.date });
    res.json({ data: result });
  }),
);
