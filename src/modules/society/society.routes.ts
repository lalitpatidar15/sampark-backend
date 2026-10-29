import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { societyService } from "./society.service";

export const societyRouter = Router();

societyRouter.use(authenticate);

societyRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const societies = await societyService.listSocieties();
    res.json({ data: societies });
  }),
);

societyRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const society = await societyService.createSociety(req.body);
    res.status(201).json({ data: society });
  }),
);

societyRouter.get(
  "/residents",
  asyncHandler(async (req, res) => {
    const residents = await societyService.listResidents(req.query as any);
    res.json({ data: residents });
  }),
);
