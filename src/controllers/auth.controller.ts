import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UserModel } from "../models/User.model";

const sanitizeEmail = (email: string): string => email.trim().toLowerCase();

const signToken = (userId: string): string =>
  jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "7d" });

const setAuthCookie = (res: Response, token: string): void => {
  res.cookie("token", token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const email = sanitizeEmail(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");

  if (!email || password.length < 6) {
    res.status(400).json({ message: "Email and password (min 6 chars) are required." });
    return;
  }

  const existing = await UserModel.findOne({ email }).lean();
  if (existing) {
    res.status(409).json({ message: "Email already exists." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await UserModel.create({ email, passwordHash });
  const token = signToken(user.id);
  setAuthCookie(res, token);

  res.status(201).json({
    user: { id: user.id, email: user.email },
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const email = sanitizeEmail(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." });
    return;
  }

  const user = await UserModel.findOne({ email });
  if (!user) {
    res.status(401).json({ message: "Invalid credentials." });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: "Invalid credentials." });
    return;
  }

  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.status(200).json({ user: { id: user.id, email: user.email } });
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
  });
  res.status(200).json({ message: "Logged out." });
};

export const me = async (req: Request, res: Response): Promise<void> => {
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

    const user = await UserModel.findById(userId).lean();
    if (!user) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    res.status(200).json({ user: { id: String(user._id), email: user.email } });
  } catch {
    res.status(401).json({ message: "Unauthorized." });
  }
};
