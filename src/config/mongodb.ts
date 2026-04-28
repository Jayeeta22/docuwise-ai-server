import mongoose from "mongoose";
import dns from "node:dns";
import { env } from "./env";

export const connectMongo = async (): Promise<void> => {
  try {
    console.log("Connecting to MongoDB (primary URI)");
    const connection = await mongoose.connect(env.mongodbUri);
    console.log("Connected to MongoDB", connection.connection.host);
  } catch (error) {
    const isSrvDnsIssue =
      error instanceof Error &&
      error.message.includes("querySrv") &&
      error.message.includes("ECONNREFUSED");

    if (!isSrvDnsIssue) {
      throw error;
    }

    // Retry SRV lookup with public DNS resolvers.
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    try {
      console.log("Retrying MongoDB connection with public DNS resolvers");
      const connection = await mongoose.connect(env.mongodbUri);
      console.log("Connected to MongoDB after DNS retry", connection.connection.host);
      return;
    } catch {
      // Fall through to standard URI fallback.
    }

    if (!env.mongodbUriFallback) {
      throw error;
    }

    // Retry with a standard Mongo URI when SRV DNS lookups are blocked.
    console.log("Retrying MongoDB connection with fallback URI");
    const connection = await mongoose.connect(env.mongodbUriFallback);
    console.log("Connected to MongoDB via fallback URI", connection.connection.host);
  }
};
