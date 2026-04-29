import { Router } from "express";
import {
  chatDocument,
  deleteDocument,
  getDocument,
  getDocumentFile,
  getChatUsage,
  listDocuments,
  translateDocument,
  uploadDocument,
  uploadMiddleware,
} from "../controllers/documents.controller";
import { requireAuth } from "../middleware/requireAuth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(listDocuments));
router.post("/upload", uploadMiddleware, asyncHandler(uploadDocument));
router.get("/chat/limit", asyncHandler(getChatUsage));
router.get("/:id", asyncHandler(getDocument));
router.get("/:id/file", asyncHandler(getDocumentFile));
router.post("/:id/chat", asyncHandler(chatDocument));
router.post("/:id/translate", asyncHandler(translateDocument));
router.delete("/:id", asyncHandler(deleteDocument));

export default router;
