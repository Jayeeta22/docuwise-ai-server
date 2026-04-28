import { Router } from "express";
import {
  chatDocument,
  getDocument,
  listDocuments,
  uploadDocument,
  uploadMiddleware,
} from "../controllers/documents.controller";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(listDocuments));
router.post("/upload", uploadMiddleware, asyncHandler(uploadDocument));
router.get("/:id", asyncHandler(getDocument));
router.post("/:id/chat", asyncHandler(chatDocument));

export default router;
