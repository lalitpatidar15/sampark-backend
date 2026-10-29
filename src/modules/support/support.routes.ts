import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { supportService } from "./support.service";

export const supportRouter = Router();

supportRouter.use(authenticate);

supportRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tickets = await supportService.listSupportTickets({
      userId: req.user?.id,
    });
    res.json({ data: tickets });
  }),
);

supportRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const ticket = await supportService.createSupportTicket({
      userId: req.user!.id,
      ...req.body,
    });
    res.status(201).json({ data: ticket });
  }),
);

supportRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const ticket = await supportService.updateTicket({
      id: req.params.id,
      data: req.body,
    });
    res.json({ data: ticket });
  }),
);
