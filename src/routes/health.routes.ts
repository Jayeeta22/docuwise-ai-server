import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "docuwise-ai-server",
    timestamp: new Date().toISOString(),
  });
});

export default router;
