import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = String(req.cookies?.token ?? "");
  if (!token) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    const userId = String(payload.sub ?? "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }
    req.userId = userId;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized." });
  }
};
