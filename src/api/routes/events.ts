import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env.js";
import { FeeEventModel } from "../../models/event.js";

const querySchema = z.object({
  integrator: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "integrator must be an EVM address"),
  chainId: z.coerce.number().int().positive().default(config.chainId),
  contractAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "contractAddress must be an EVM address")
    .default(config.contractAddress),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/events", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const query = {
      ...parsed.data,
      integrator: parsed.data.integrator.toLowerCase(),
      contractAddress: parsed.data.contractAddress.toLowerCase(),
    };

    const events = await FeeEventModel.find({
      chainId: query.chainId,
      contractAddress: query.contractAddress,
      integrator: query.integrator,
    })
      .sort({ blockNumber: 1, logIndex: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .lean();

    return {
      events,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
    };
  });
}
