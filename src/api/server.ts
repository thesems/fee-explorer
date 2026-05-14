import Fastify from "fastify";
import { config } from "../config/env.js";
import { connectMongo, disconnectMongo } from "../db/mongo.js";
import { apiLogger } from "../shared/logger.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";

const app = Fastify({ loggerInstance: apiLogger });
let shuttingDown = false;

async function main(): Promise<void> {
  try {
    await connectMongo(config.mongoUri);
    await app.register(healthRoutes);
    await app.register(eventRoutes);
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    await shutdown("startup-failure", 1);
  }
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await app.close();
  await disconnectMongo();
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await main();
