import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://localhost:27017/fee_explorer_test";
process.env.RPC_URL = "https://polygon-rpc.com";
process.env.CONTRACT_ADDRESS = "0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9";

const { eventRoutes } = await import("./events.js");
const { FeeEventModel } = await import("../../models/event.js");

const defaultContractAddress = "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9";
const integrator = "0x1111111111111111111111111111111111111111";
const mixedCaseIntegrator = "0xAa11111111111111111111111111111111111111";
const normalizedMixedCaseIntegrator =
  "0xaa11111111111111111111111111111111111111";

type FindFilter = {
  chainId: number;
  contractAddress: string;
  integrator: string;
};

async function buildApp() {
  const app = Fastify();
  await app.register(eventRoutes);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("GET /events returns events for an integrator using configured defaults", async () => {
  const app = await buildApp();

  try {
    const events = [
      { blockNumber: 12, logIndex: 1, integrator },
      { blockNumber: 10, logIndex: 0, integrator },
    ];
    const calls = stubFind(events);

    const response = await app.inject({
      method: "GET",
      url: `/events?integrator=${mixedCaseIntegrator}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      events,
      pagination: {
        limit: 100,
        offset: 0,
      },
    });
    expect(calls.filters).toEqual([
      {
        chainId: 137,
        contractAddress: defaultContractAddress,
        integrator: normalizedMixedCaseIntegrator,
      },
    ]);
    expect(calls.sorts).toEqual([{ blockNumber: 1, logIndex: 1 }]);
    expect(calls.skips).toEqual([0]);
    expect(calls.limits).toEqual([100]);
  } finally {
    await app.close();
  }
});

test("GET /events accepts optional chainId and contractAddress filters", async () => {
  const app = await buildApp();

  try {
    const calls = stubFind([]);

    const response = await app.inject({
      method: "GET",
      url: `/events?integrator=${integrator}&chainId=1&contractAddress=0xBb22222222222222222222222222222222222222&limit=50&offset=150`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      events: [],
      pagination: {
        limit: 50,
        offset: 150,
      },
    });
    expect(calls.filters).toEqual([
      {
        chainId: 1,
        contractAddress: "0xbb22222222222222222222222222222222222222",
        integrator,
      },
    ]);
    expect(calls.skips).toEqual([150]);
    expect(calls.limits).toEqual([50]);
  } finally {
    await app.close();
  }
});

test("GET /events rejects invalid query parameters", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/events?integrator=not-an-address",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "Invalid query parameters",
      errors: {
        integrator: ["integrator must be an EVM address"],
      },
    });
  } finally {
    await app.close();
  }
});

test("GET /events rejects invalid pagination parameters", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/events?integrator=${integrator}&limit=501&offset=-1`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Invalid query parameters",
      errors: {
        limit: expect.any(Array),
        offset: expect.any(Array),
      },
    });
  } finally {
    await app.close();
  }
});

function stubFind(events: unknown[]) {
  const filters: FindFilter[] = [];
  const sorts: Array<Record<string, 1 | -1>> = [];
  const skips: number[] = [];
  const limits: number[] = [];

  vi.spyOn(FeeEventModel, "find").mockImplementation(((filter: FindFilter) => {
    filters.push(filter);

    return {
      sort(sort: Record<string, 1 | -1>) {
        sorts.push(sort);
        return {
          skip(skip: number) {
            skips.push(skip);
            return {
              limit(limit: number) {
                limits.push(limit);
                return {
                  lean: async () => events,
                };
              },
            };
          },
        };
      },
    };
  }) as typeof FeeEventModel.find);

  return {
    filters,
    sorts,
    skips,
    limits,
  };
}
