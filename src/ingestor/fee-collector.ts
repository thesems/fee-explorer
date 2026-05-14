import { ethers } from "ethers";
import pRetry from "p-retry";
import {
  feesCollectedTopic,
  parseFeesCollectedLog,
} from "../contracts/fee-collector.js";
import { FeeEventModel } from "../models/event.js";
import { IngestionProgressModel } from "../models/progress.js";
import { ingestorLogger } from "../shared/logger.js";
import { sleep } from "../shared/time.js";

export interface FeeCollectorIngestorConfig {
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  startBlock: number;
  pollIntervalMs: number;
  blockBatchSize: number;
  blockConfirmationOffset: number;
}

export class FeeCollectorIngestor {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly contractAddress: string;
  private stopped = false;
  private nextToProcessBlock: number | undefined;

  public constructor(private readonly config: FeeCollectorIngestorConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(
      config.rpcUrl,
      config.chainId,
    );
    this.contractAddress = config.contractAddress.toLowerCase();
  }

  public stop(): void {
    this.stopped = true;
  }

  public async run(): Promise<void> {
    if (this.nextToProcessBlock == undefined) {
      this.nextToProcessBlock = await this.nextBlock();
    }

    while (!this.stopped) {
      try {
        const ingested = await this.processNextSafeRange();
        if (ingested) {
          continue;
        }
      } catch (error) {
        ingestorLogger.error(
          {
            error,
            nextToProcessBlock: this.nextToProcessBlock,
          },
          "ingestion iteration failed; retrying after delay",
        );
      }

      await sleep(this.config.pollIntervalMs);
    }
  }

  private async processNextSafeRange(): Promise<boolean> {
    const latestBlock = await this.retryRpc("get block number", () =>
      this.provider.getBlockNumber(),
    );
    const safeLatestBlock = Math.max(
      0,
      latestBlock - this.config.blockConfirmationOffset,
    );

    if (this.nextToProcessBlock == undefined) {
      this.nextToProcessBlock = await this.nextBlock();
    }

    if (this.nextToProcessBlock > safeLatestBlock) {
      return false;
    }

    await this.ingestRange(this.nextToProcessBlock, safeLatestBlock);
    return true;
  }

  private async nextBlock(): Promise<number> {
    const progress = await IngestionProgressModel.findOne({
      chainId: this.config.chainId,
      contractId: this.contractAddress,
    }).lean();

    return progress ? progress.lastProcessedBlock + 1 : this.config.startBlock;
  }

  private async ingestRange(fromBlock: number, toBlock: number): Promise<void> {
    let cursor = fromBlock;

    while (!this.stopped && cursor <= toBlock) {
      const safeToBlock = Math.min(
        cursor + this.config.blockBatchSize - 1,
        toBlock,
      );
      await this.ingestBatch(cursor, safeToBlock);
      cursor = safeToBlock + 1;
      this.nextToProcessBlock = cursor;
    }
  }

  private async ingestBatch(fromBlock: number, toBlock: number): Promise<void> {
    const logs = await this.fetchFeeCollectedLogs(fromBlock, toBlock);
    const operations = await this.buildFeeEventOperations(logs);
    const writeResult = await this.writeFeeEvents(operations);

    // progress can only be updated, once the fee events are written
    await this.updateProgress(toBlock);

    ingestorLogger.info(
      {
        fromBlock,
        toBlock,
        logs: logs.length,
        inserted: writeResult?.insertedCount ?? 0,
        matched: writeResult?.matchedCount ?? 0,
        modified: writeResult?.modifiedCount ?? 0,
        upserted: writeResult?.upsertedCount ?? 0,
      },
      "ingested fee collector block range",
    );
  }

  private async updateProgress(lastProcessedBlock: number): Promise<void> {
    await IngestionProgressModel.updateOne(
      {
        chainId: this.config.chainId,
        contractId: this.contractAddress,
      },
      {
        $set: {
          lastProcessedBlock,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  private async fetchFeeCollectedLogs(
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.providers.Log[]> {
    const logs = await this.retryRpc("get logs", () =>
      this.provider.getLogs({
        address: this.contractAddress,
        fromBlock,
        toBlock,
        topics: [feesCollectedTopic],
      }),
    );

    return logs;
  }

  private async buildFeeEventOperations(
    logs: ethers.providers.Log[],
  ): Promise<Parameters<typeof FeeEventModel.bulkWrite>[0]> {
    const timestamps = new Map<number, Date>();
    const operations: Parameters<typeof FeeEventModel.bulkWrite>[0] = [];

    for (const log of logs) {
      const parsed = parseFeesCollectedLog(log);
      let timestamp = timestamps.get(log.blockNumber);

      if (!timestamp) {
        const block = await this.retryRpc("get block", () =>
          this.provider.getBlock(log.blockNumber),
        );
        timestamp = new Date(block.timestamp * 1000);
        timestamps.set(log.blockNumber, timestamp);
      }

      operations.push({
        updateOne: {
          filter: {
            chainId: this.config.chainId,
            contractAddress: this.contractAddress,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          },
          update: {
            $setOnInsert: {
              chainId: this.config.chainId,
              contractAddress: this.contractAddress,
              tokenAddress: parsed.tokenAddress,
              integrator: parsed.integrator,
              integratorFee: parsed.integratorFee,
              lifiFee: parsed.lifiFee,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              transactionHash: log.transactionHash.toLowerCase(),
              timestamp,
            },
          },
          upsert: true,
        },
      });
    }

    return operations;
  }

  private async writeFeeEvents(
    operations: Parameters<typeof FeeEventModel.bulkWrite>[0],
  ): Promise<Awaited<ReturnType<typeof FeeEventModel.bulkWrite>> | undefined> {
    return operations.length > 0
      ? FeeEventModel.bulkWrite(operations, {
          ordered: false,
          throwOnValidationError: true,
        })
      : undefined;
  }

  private async retryRpc<T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return pRetry(operation, {
      retries: 5,
      shouldRetry: ({ error }) => this.isRetryableRpcError(error),
      onFailedAttempt: (error) => {
        ingestorLogger.warn(
          {
            error,
            label,
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
          },
          "rpc request failed",
        );
      },
    });
  }

  private isRetryableRpcError(error: Error): boolean {
    const rpcError = error as Error & { status?: number; code?: string };
    const status = rpcError.status;
    const code = rpcError.code;

    if (status != null) {
      return status === 429 || status >= 500;
    }

    return code === "TIMEOUT" || code === "NETWORK_ERROR";
  }
}
