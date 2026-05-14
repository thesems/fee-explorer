import type { FastifyInstance } from "fastify";
import { isMongoReady } from "../../db/mongo.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/livez", async () => {
    return { ok: true };
  });

  app.get("/readyz", async (_request, reply) => {
    if (!isMongoReady()) {
      return reply
        .code(503)
        .send({ ok: false, message: "MongoDB is not connected" });
    }

    return { ok: true };
  });
}
