import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { fraudService } from "./fraud.service";

export const fraudRouter = Router();

fraudRouter.use(authenticate);

fraudRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const reports = await fraudService.listAbuseReports({});
    res.json({ data: reports });
  }),
);

fraudRouter.post(
  "/:id/review",
  asyncHandler(async (req, res) => {
    const report = await fraudService.reviewReport({
      reportId: req.params.id,
      state: req.body.state,
      actionTaken: req.body.actionTaken,
    });
    res.json({ data: report });
  }),
);

fraudRouter.post(
  "/auto-suspend",
  asyncHandler(async (req, res) => {
    const result = await fraudService.autoSuspendTags();
    res.json({ data: result });
  }),
);
