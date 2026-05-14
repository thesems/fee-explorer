import Fastify from "fastify";
import { ethers, type providers } from "ethers";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { connectMongo, disconnectMongo } from "../db/mongo.js";
import { FeeEventModel } from "../models/event.js";
import { IngestionProgressModel } from "../models/progress.js";
import {
  FeeCollectorIngestor,
  type FeeCollectorIngestorConfig,
} from "./fee-collector.js";

process.env.MONGODB_URI = "mongodb://localhost:27017/fee_explorer_test";
process.env.RPC_URL = "https://polygon-rpc.com";
process.env.CONTRACT_ADDRESS = "0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9";

type TestableFeeCollectorIngestor = {
  provider: {
    getBlock(blockNumber: number): Promise<providers.Block>;
    getBlockNumber(): Promise<number>;
    getLogs(filter: providers.Filter): Promise<providers.Log[]>;
  };
  run(): Promise<void>;
  ingestBatch(fromBlock: number, toBlock: number): Promise<void>;
  stop(): void;
};

const contractAddress = "0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9";
const normalizedContractAddress = "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9";
const tokenAddress = "0x1111111111111111111111111111111111111111";
const integrator = "0x2222222222222222222222222222222222222222";
const feesCollectedInterface = new ethers.utils.Interface([
  "event FeesCollected(address indexed _token, address indexed _integrator, uint256 _integratorFee, uint256 _lifiFee)",
]);

const config: FeeCollectorIngestorConfig = {
  chainId: 137,
  rpcUrl: "https://polygon-rpc.com",
  contractAddress,
  startBlock: 100,
  pollIntervalMs: 1,
  blockBatchSize: 2,
  blockConfirmationOffset: 64,
};

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    instance: {
      ip: "127.0.0.1",
    },
  });
  await connectMongo(mongo.getUri());
  await Promise.all([
    FeeEventModel.syncIndexes(),
    IngestionProgressModel.syncIndexes(),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    FeeEventModel.deleteMany({}),
    IngestionProgressModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectMongo();
  await mongo?.stop();
});

test("ingestor run persists fee events and progress in MongoDB", async () => {
  const ingestor = buildIngestor();
  const logs = buildLogs();

  vi.spyOn(ingestor.provider, "getBlockNumber")
    .mockResolvedValueOnce(165)
    .mockImplementationOnce(async () => {
      ingestor.stop();
      return 165;
    });
  vi.spyOn(ingestor.provider, "getLogs").mockResolvedValue(logs);
  vi.spyOn(ingestor.provider, "getBlock").mockImplementation(
    async (blockNumber: number) =>
      ({
        timestamp: blockNumber === 100 ? 1_767_225_600 : 1_767_225_612,
      }) as providers.Block,
  );

  await ingestor.run();

  const events = await FeeEventModel.find({})
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean();
  expect(events).toHaveLength(2);
  expect(events).toMatchObject([
    {
      chainId: 137,
      contractAddress: normalizedContractAddress,
      tokenAddress,
      integrator,
      integratorFee: "10",
      lifiFee: "2",
      blockNumber: 100,
      logIndex: 0,
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timestamp: new Date(1_767_225_600_000),
    },
    {
      chainId: 137,
      contractAddress: normalizedContractAddress,
      tokenAddress,
      integrator,
      integratorFee: "20",
      lifiFee: "4",
      blockNumber: 101,
      logIndex: 1,
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      timestamp: new Date(1_767_225_612_000),
    },
  ]);

  const progress = await IngestionProgressModel.findOne({
    chainId: 137,
    contractId: normalizedContractAddress,
  }).lean();
  expect(progress).toMatchObject({
    lastProcessedBlock: 101,
  });
});

test("ingestion is idempotent when the same logs are processed twice", async () => {
  const ingestor = buildIngestor();

  vi.spyOn(ingestor.provider, "getLogs").mockResolvedValue(buildLogs());
  vi.spyOn(ingestor.provider, "getBlock").mockImplementation(
    async (blockNumber: number) =>
      ({
        timestamp: blockNumber === 100 ? 1_767_225_600 : 1_767_225_612,
      }) as providers.Block,
  );

  await ingestor.ingestBatch(100, 101);
  await ingestor.ingestBatch(100, 101);

  await expect(FeeEventModel.countDocuments({})).resolves.toBe(2);
  await expect(
    IngestionProgressModel.findOne({
      chainId: 137,
      contractId: normalizedContractAddress,
    }).lean(),
  ).resolves.toMatchObject({ lastProcessedBlock: 101 });
});

test("API returns persisted MongoDB events by integrator", async () => {
  const { eventRoutes } = await import("../api/routes/events.js");
  await FeeEventModel.create([
    {
      chainId: 137,
      contractAddress: normalizedContractAddress,
      tokenAddress,
      integrator,
      integratorFee: "20",
      lifiFee: "4",
      blockNumber: 101,
      logIndex: 1,
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      timestamp: new Date(1_767_225_612_000),
    },
    {
      chainId: 137,
      contractAddress: normalizedContractAddress,
      tokenAddress,
      integrator,
      integratorFee: "10",
      lifiFee: "2",
      blockNumber: 100,
      logIndex: 0,
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timestamp: new Date(1_767_225_600_000),
    },
  ]);
  const app = Fastify();
  await app.register(eventRoutes);

  try {
    const response = await app.inject({
      method: "GET",
      url: `/events?integrator=${integrator}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      events: Array<{ blockNumber: number; logIndex: number }>;
    };
    expect(
      body.events.map(({ blockNumber, logIndex }) => ({
        blockNumber,
        logIndex,
      })),
    ).toEqual([
      { blockNumber: 100, logIndex: 0 },
      { blockNumber: 101, logIndex: 1 },
    ]);
  } finally {
    await app.close();
  }
});

function buildIngestor(): TestableFeeCollectorIngestor {
  return new FeeCollectorIngestor(
    config,
  ) as unknown as TestableFeeCollectorIngestor;
}

function buildLogs(): providers.Log[] {
  return [
    buildFeesCollectedLog({
      integratorFee: 10,
      lifiFee: 2,
      blockNumber: 100,
      logIndex: 0,
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    buildFeesCollectedLog({
      integratorFee: 20,
      lifiFee: 4,
      blockNumber: 101,
      logIndex: 1,
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  ];
}

function buildFeesCollectedLog({
  integratorFee,
  lifiFee,
  ...overrides
}: {
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
