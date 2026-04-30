import "./types/expressRequestAugment";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { CorsOptions } from "cors";
import express from "express";
import morgan from "morgan";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import documentsRoutes from "./routes/documents.routes";
import healthRoutes from "./routes/health.routes";

export const app = express();

const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["*"];

    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: allowedMethods,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-access-token", "user", "outlet", "apikey"],
};

app.use(cors(corsOptions));
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
