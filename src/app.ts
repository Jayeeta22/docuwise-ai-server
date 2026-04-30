import "./types/expressRequestAugment";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import documentsRoutes from "./routes/documents.routes";
import healthRoutes from "./routes/health.routes";

export const app = express();

app.use(
  cors({
    // Production: explicit UI origins only. Development: reflect any Origin (any Vite port, etc.).
    origin: env.nodeEnv === "production" ? env.corsOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
