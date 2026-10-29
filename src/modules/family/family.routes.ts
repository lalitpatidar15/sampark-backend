import { Router } from "express";
import { authenticate } from "../../common/middleware/auth";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { familyService } from "./family.service";

export const familyRouter = Router();

familyRouter.use(authenticate);

familyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const members = await familyService.listFamilyMembers({
      ownerId: req.user?.id,
    });
    res.json({ data: members });
  }),
);

familyRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const member = await familyService.createFamilyMember({
      ownerId: req.user!.id,
      ...req.body,
    });
    res.status(201).json({ data: member });
  }),
);

familyRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const member = await familyService.updateFamilyMember({
      id: req.params.id,
      data: req.body,
    });
    res.json({ data: member });
  }),
);

familyRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await familyService.deleteFamilyMember({ id: req.params.id });
    res.status(204).send();
  }),
);
