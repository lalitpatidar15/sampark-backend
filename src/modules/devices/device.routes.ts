import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { deviceService } from "./device.service";

export const deviceRouter = Router();

deviceRouter.use(authenticate);

deviceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const devices = await deviceService.listDevices({
      userId: req.user?.id,
    });
    res.json({ data: devices });
  }),
);

deviceRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const device = await deviceService.createDevice({
      userId: req.user!.id,
      ...req.body,
    });
    res.status(201).json({ data: device });
  }),
);

deviceRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const device = await deviceService.updateDevice({
      id: req.params.id,
      data: req.body,
    });
    res.json({ data: device });
  }),
);

deviceRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deviceService.deleteDevice({ id: req.params.id });
    res.status(204).send();
  }),
);
