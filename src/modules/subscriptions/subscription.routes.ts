import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { subscriptionService } from "./subscription.service";

export const subscriptionRouter = Router();

subscriptionRouter.use(authenticate);

subscriptionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const subs = await subscriptionService.listSubscriptions({
      userId: req.user?.id,
    });
    res.json({ data: subs });
  }),
);

subscriptionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const sub = await subscriptionService.createSubscription({
      userId: req.user!.id,
      ...req.body,
    });
    res.status(201).json({ data: sub });
  }),
);

subscriptionRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const sub = await subscriptionService.updateSubscription({
      id: req.params.id,
      data: req.body,
    });
    res.json({ data: sub });
  }),
);

subscriptionRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const sub = await subscriptionService.cancelSubscription({
      id: req.params.id,
    });
    res.json({ data: sub });
  }),
);
