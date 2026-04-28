import dotenv from "dotenv";

dotenv.config();

const required = ["MONGODB_URI", "JWT_SECRET"] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env variable: ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI as string,
  mongodbUriFallback: process.env.MONGODB_URI_FALLBACK,
  jwtSecret: process.env.JWT_SECRET as string,
};
