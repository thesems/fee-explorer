import { ethers, type providers } from "ethers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { feesCollectedTopic } from "../contracts/fee-collector.js";
import { FeeEventModel } from "../models/event.js";
import { IngestionProgressModel } from "../models/progress.js";
import { sleep } from "../shared/time.js";
import {
  FeeCollectorIngestor,
  type FeeCollectorIngestorConfig,
} from "./fee-collector.js";

vi.mock("../shared/time.js", () => ({
  sleep: vi.fn(async () => undefined),
}));

type TestableFeeCollectorIngestor = {
  provider: {
    getBlock(blockNumber: number): Promise<providers.Block>;
    getBlockNumber(): Promise<number>;
    getLogs(filter: providers.Filter): Promise<providers.Log[]>;
  };
  run(): Promise<void>;
  ingestRange(fromBlock: number, toBlock: number): Promise<void>;
  ingestBatch(fromBlock: number, toBlock: number): Promise<void>;
  fetchFeeCollectedLogs(
    fromBlock: number,
    toBlock: number,
  ): Promise<providers.Log[]>;
  stop(): void;
};

const defaultConfig: FeeCollectorIngestorConfig = {
  chainId: 137,
  rpcUrl: "https://polygon-rpc.com",
  contractAddress: "0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9",
  startBlock: 100,
  pollIntervalMs: 5000,
  blockBatchSize: 2000,
  blockConfirmationOffset: 64,
};

const normalizedContractAddress = "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9";
const feesCollectedInterface = new ethers.utils.Interface([
  "event FeesCollected(address indexed _token, address indexed _integrator, uint256 _integratorFee, uint256 _lifiFee)",
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run", () => {
  test("uses saved progress, applies confirmation offset, and ingests safe range", async () => {
    const ingestor = buildIngestor();
    const findOne = stubProgress({ lastProcessedBlock: 123 });
    const getBlockNumber = vi
      .spyOn(ingestor.provider, "getBlockNumber")
      .mockResolvedValue(200);
    const ingestRange = vi
      .spyOn(ingestor, "ingestRange")
      .mockImplementation(async () => {
        ingestor.stop();
      });

    await ingestor.run();

    expect(findOne).toHaveBeenCalledWith({
      chainId: 137,
      contractId: normalizedContractAddress,
    });
    expect(getBlockNumber).toHaveBeenCalled();
    expect(ingestRange).toHaveBeenCalledWith(124, 136);
  });

  test("uses startBlock when no progress exists", async () => {
    const ingestor = buildIngestor({ startBlock: 100 });

    stubProgress(null);
    vi.spyOn(ingestor.provider, "getBlockNumber").mockResolvedValue(200);
    const ingestRange = vi
      .spyOn(ingestor, "ingestRange")
      .mockImplementation(async () => {
        ingestor.stop();
      });

    await ingestor.run();

    expect(ingestRange).toHaveBeenCalledWith(100, 136);
  });

  test("sleeps without ingesting when no safe blocks are available", async () => {
    const ingestor = buildIngestor({
      startBlock: 100,
      pollIntervalMs: 5000,
      blockConfirmationOffset: 64,
    });

    stubProgress(null);
    vi.spyOn(ingestor.provider, "getBlockNumber").mockResolvedValue(120);
    const ingestRange = vi
      .spyOn(ingestor, "ingestRange")
      .mockResolvedValue(undefined);
    vi.mocked(sleep).mockImplementationOnce(async () => {
      ingestor.stop();
    });

    await ingestor.run();

    expect(ingestRange).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  test("sleeps without ingesting when an iteration fails", async () => {
    const ingestor = buildIngestor({ pollIntervalMs: 5000 });

    stubProgress(null);
    const getBlockNumber = vi
      .spyOn(ingestor.provider, "getBlockNumber")
      .mockRejectedValue(new Error("rpc failed"));
    const ingestRange = vi
      .spyOn(ingestor, "ingestRange")
      .mockResolvedValue(undefined);
    vi.mocked(sleep).mockImplementationOnce(async () => {
      ingestor.stop();
    });

    await ingestor.run();

    expect(getBlockNumber).toHaveBeenCalled();
    expect(ingestRange).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(5000);
  });
});

describe("fetchFeeCollectedLogs", () => {
  test("sends the correct provider query", async () => {
    const ingestor = buildIngestor();
    const getLogs = vi
      .spyOn(ingestor.provider, "getLogs")
      .mockResolvedValue([]);

    await ingestor.fetchFeeCollectedLogs(100, 120);

    expect(getLogs).toHaveBeenCalledWith({
      address: normalizedContractAddress,
      fromBlock: 100,
      toBlock: 120,
      topics: [feesCollectedTopic],
    });
  });
});

describe("ingestBatch", () => {
  test("builds and writes fee events, then updates progress", async () => {
    const ingestor = new FeeCollectorIngestor(
      defaultConfig,
    ) as unknown as TestableFeeCollectorIngestor;
    const tokenAddress = "0x1111111111111111111111111111111111111111";
    const integrator = "0x2222222222222222222222222222222222222222";
    const firstTransactionHash =
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const secondTransactionHash =
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const logs = [
      buildFeesCollectedLog({
        tokenAddress,
        integrator,
        integratorFee: 10,
        lifiFee: 2,
        blockNumber: 100,
        logIndex: 0,
        transactionHash: firstTransactionHash,
      }),
      buildFeesCollectedLog({
        tokenAddress,
        integrator,
        integratorFee: 20,
        lifiFee: 4,
        blockNumber: 101,
        logIndex: 1,
        transactionHash: secondTransactionHash,
      }),
    ];
    const firstTimestamp = new Date(1_767_225_600_000);
    const secondTimestamp = new Date(1_767_225_612_000);

    const fetchFeeCollectedLogs = vi
      .spyOn(ingestor, "fetchFeeCollectedLogs")
      .mockResolvedValue(logs);
    const getBlock = vi
      .spyOn(ingestor.provider, "getBlock")
      .mockResolvedValueOnce({ timestamp: 1_767_225_600 } as providers.Block)
      .mockResolvedValueOnce({ timestamp: 1_767_225_612 } as providers.Block);
    const bulkWrite = vi.spyOn(FeeEventModel, "bulkWrite").mockResolvedValue({
      insertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    } as Awaited<ReturnType<typeof FeeEventModel.bulkWrite>>);
    const updateProgress = vi
      .spyOn(IngestionProgressModel, "updateOne")
      .mockResolvedValue({ acknowledged: true } as Awaited<
        ReturnType<typeof IngestionProgressModel.updateOne>
      >);

    await ingestor.ingestBatch(100, 120);

    expect(fetchFeeCollectedLogs).toHaveBeenCalledWith(100, 120);
    expect(getBlock).toHaveBeenCalledTimes(2);
    expect(getBlock).toHaveBeenNthCalledWith(1, 100);
    expect(getBlock).toHaveBeenNthCalledWith(2, 101);
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: {
              chainId: 137,
              contractAddress: normalizedContractAddress,
              blockNumber: 100,
              logIndex: 0,
            },
            update: {
              $setOnInsert: {
                chainId: 137,
                contractAddress: normalizedContractAddress,
                tokenAddress,
                integrator,
                integratorFee: "10",
                lifiFee: "2",
                blockNumber: 100,
                logIndex: 0,
                transactionHash: firstTransactionHash.toLowerCase(),
                timestamp: firstTimestamp,
              },
            },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter: {
              chainId: 137,
              contractAddress: normalizedContractAddress,
              blockNumber: 101,
              logIndex: 1,
            },
            update: {
              $setOnInsert: {
                chainId: 137,
                contractAddress: normalizedContractAddress,
                tokenAddress,
                integrator,
                integratorFee: "20",
                lifiFee: "4",
                blockNumber: 101,
                logIndex: 1,
                transactionHash: secondTransactionHash.toLowerCase(),
                timestamp: secondTimestamp,
              },
            },
            upsert: true,
          },
        },
      ],
      {
        ordered: false,
        throwOnValidationError: true,
      },
    );
    expect(updateProgress).toHaveBeenCalledWith(
      {
        chainId: 137,
        contractId: normalizedContractAddress,
      },
      {
        $set: {
          lastProcessedBlock: 120,
          updatedAt: expect.any(Date),
        },
      },
      { upsert: true },
    );
  });

  test("skips fee event writes and still updates progress when no logs are found", async () => {
    const ingestor = new FeeCollectorIngestor(
      defaultConfig,
    ) as unknown as TestableFeeCollectorIngestor;

    vi.spyOn(ingestor, "fetchFeeCollectedLogs").mockResolvedValue([]);
    const bulkWrite = vi.spyOn(FeeEventModel, "bulkWrite");
    const updateProgress = vi
      .spyOn(IngestionProgressModel, "updateOne")
      .mockResolvedValue({ acknowledged: true } as Awaited<
        ReturnType<typeof IngestionProgressModel.updateOne>
      >);

    await ingestor.ingestBatch(100, 120);

    expect(bulkWrite).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith(
      {
        chainId: 137,
        contractId: normalizedContractAddress,
      },
      {
        $set: {
          lastProcessedBlock: 120,
          updatedAt: expect.any(Date),
        },
      },
      { upsert: true },
    );
  });
});

describe("ingestRange", () => {
  test("batches the requested range until complete", async () => {
    const ingestor = buildIngestor({ blockBatchSize: 10 });
    const ingestBatch = vi
      .spyOn(ingestor, "ingestBatch")
      .mockResolvedValue(undefined);

    await ingestor.ingestRange(100, 124);

    expect(ingestBatch).toHaveBeenCalledTimes(3);
    expect(ingestBatch).toHaveBeenNthCalledWith(1, 100, 109);
    expect(ingestBatch).toHaveBeenNthCalledWith(2, 110, 119);
    expect(ingestBatch).toHaveBeenNthCalledWith(3, 120, 124);
  });

  test("does nothing when fromBlock is greater than toBlock", async () => {
    const ingestor = buildIngestor({ blockBatchSize: 10 });
    const ingestBatch = vi
      .spyOn(ingestor, "ingestBatch")
      .mockResolvedValue(undefined);

    await ingestor.ingestRange(125, 124);

    expect(ingestBatch).not.toHaveBeenCalled();
  });

  test("stops after the current batch when stop is requested", async () => {
    const ingestor = buildIngestor({ blockBatchSize: 10 });
    const ingestBatch = vi
      .spyOn(ingestor, "ingestBatch")
      .mockImplementation(async () => {
        ingestor.stop();
      });

    await ingestor.ingestRange(100, 124);

    expect(ingestBatch).toHaveBeenCalledTimes(1);
    expect(ingestBatch).toHaveBeenCalledWith(100, 109);
  });
});

function buildIngestor(
  config: Partial<FeeCollectorIngestorConfig> = {},
): TestableFeeCollectorIngestor {
  return new FeeCollectorIngestor({
    ...defaultConfig,
    ...config,
  }) as unknown as TestableFeeCollectorIngestor;
}

function stubProgress(progress: { lastProcessedBlock: number } | null) {
  return vi.spyOn(IngestionProgressModel, "findOne").mockReturnValue({
    lean: async () => progress,
  } as ReturnType<typeof IngestionProgressModel.findOne>);
}

function buildFeesCollectedLog({
  tokenAddress,
  integrator,
  integratorFee,
  lifiFee,
  ...overrides
}: {
  tokenAddress: string;
  integrator: string;
  integratorFee: number;
  lifiFee: number;
} & Partial<providers.Log>): providers.Log {
  const encoded = feesCollectedInterface.encodeEventLog(
    feesCollectedInterface.getEvent("FeesCollected"),
    [tokenAddress, integrator, integratorFee, lifiFee],
  );

  return {
    blockNumber: 100,
    blockHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    transactionIndex: 0,
    removed: false,
    address: normalizedContractAddress,
    data: encoded.data,
    topics: encoded.topics,
    transactionHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
    ...overrides,
  };
}
