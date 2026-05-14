import { expect, test } from "vitest";
import { parseConfig } from "./parse-env.js";

test("parseConfig applies defaults and normalizes addresses", () => {
  const result = parseConfig({
    MONGODB_URI: "mongodb://localhost:27017/fee_explorer",
    RPC_URL: "https://polygon-rpc.com",
    CONTRACT_ADDRESS: "0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9",
  });

  expect(result.success).toBe(true);

  if (!result.success) {
    throw new Error("expected config parsing to succeed");
  }

  expect(result.config.host).toBe("0.0.0.0");
  expect(result.config.port).toBe(3000);
  expect(result.config.logFormat).toBe("json");
  expect(result.config.chainId).toBe(137);
  expect(result.config.rpcUrl).toBe("https://polygon-rpc.com");
  expect(result.config.contractAddress).toBe(
    "0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9",
  );
  expect(result.config.startBlock).toBe(78600000);
  expect(result.config.pollIntervalMs).toBe(5000);
  expect(result.config.blockBatchSize).toBe(2000);
  expect(result.config.blockConfirmationOffset).toBe(64);
});

test("parseConfig rejects invalid contract addresses", () => {
  const result = parseConfig({
    MONGODB_URI: "mongodb://localhost:27017/fee_explorer",
    RPC_URL: "https://polygon-rpc.com",
    CONTRACT_ADDRESS: "not-an-address",
  });

  expect(result.success).toBe(false);
});
