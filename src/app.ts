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

const allowedOrigins = new Set([env.clientUrl, "http://localhost:5173", "http://127.0.0.1:5173"]);

/** Any port — fixes "API offline" when Vite picks 5174+ because 5173 is taken. */
function isLocalDevBrowserOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin) and known local frontend origins.
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      // Development: allow any localhost / 127.0.0.1 port so health + auth work
      // even if Vite shifts ports (5174, 5175, ...).
      if (env.nodeEnv !== "production" && isLocalDevBrowserOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
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
