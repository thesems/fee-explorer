import "dotenv/config";
import { parseConfig } from "./parse-env.js";

const parsed = parseConfig(process.env);

if (!parsed.success) {
  console.error("Invalid configuration:");
  console.error(parsed.errors);
  process.exit(1);
}

export const config = parsed.config;
