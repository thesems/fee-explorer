import pino from "pino";

const loggerOptions =
  process.env.LOG_FORMAT === "pretty"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss.l",
          },
        },
      }
    : {};

export const logger = pino(loggerOptions);
export const apiLogger = logger.child({ component: "api" });
export const ingestorLogger = logger.child({ component: "ingestor" });
