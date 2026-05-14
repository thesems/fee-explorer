import { config } from "../config/env.js";
import { connectMongo, disconnectMongo } from "../db/mongo.js";
import { ingestorLogger } from "../shared/logger.js";
import { FeeCollectorIngestor } from "./fee-collector.js";

let ingestor: FeeCollectorIngestor | undefined;
let shuttingDown = false;

async function main(): Promise<void> {
  await connectMongo(config.mongoUri);

  ingestor = new FeeCollectorIngestor({
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    contractAddress: config.contractAddress,
    startBlock: config.startBlock,
    pollIntervalMs: config.pollIntervalMs,
    blockBatchSize: config.blockBatchSize,
    blockConfirmationOffset: config.blockConfirmationOffset,
  });

  await ingestor.run();
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  ingestorLogger.info({ signal }, "shutting down");
  ingestor?.stop();
  await disconnectMongo();
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error: unknown) => {
  ingestorLogger.error({ error }, "ingestor failed");
  void shutdown("startup-failure", 1);
});
