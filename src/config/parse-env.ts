import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  MONGODB_URI: z.string().trim().min(1, "MONGODB_URI is required"),
  CHAIN_ID: z.coerce.number().int().positive().default(137),
  RPC_URL: z.url("RPC_URL must be a valid URL"),
  CONTRACT_ADDRESS: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "CONTRACT_ADDRESS must be an EVM address"),
  START_BLOCK: z.coerce.number().int().nonnegative().default(78600000),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  BLOCK_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
  BLOCK_CONFIRMATION_OFFSET: z.coerce.number().int().positive().default(64),
});

export type AppConfig = ReturnType<typeof parseConfig>;

export function parseConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    return {
      success: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  return {
    success: true as const,
    config: {
      host: parsed.data.HOST,
      port: parsed.data.PORT,
      logFormat: parsed.data.LOG_FORMAT,
      mongoUri: parsed.data.MONGODB_URI,
      chainId: parsed.data.CHAIN_ID,
      rpcUrl: parsed.data.RPC_URL,
      contractAddress: parsed.data.CONTRACT_ADDRESS.toLowerCase(),
      startBlock: parsed.data.START_BLOCK,
      pollIntervalMs: parsed.data.POLL_INTERVAL_MS,
      blockBatchSize: parsed.data.BLOCK_BATCH_SIZE,
      blockConfirmationOffset: parsed.data.BLOCK_CONFIRMATION_OFFSET,
    },
  };
}
