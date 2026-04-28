import { app } from "./app";
import { connectMongo } from "./config/mongodb";
import { env } from "./config/env";

const bootstrap = async (): Promise<void> => {
  await connectMongo();

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${env.port}`);
  });
};

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  process.exit(1);
});
