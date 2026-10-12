import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_DB_PATH, openDb, type DB } from "./db/connection";
import { DEFAULT_LIMIT, MAX_LIMIT, recommend } from "./recommend";

export function buildApp(db: DB, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: { id: number }; Querystring: { limit: number } }>(
    "/users/:id/recommendations",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", minimum: 1 } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          },
        },
      },
    },
    async (request, reply) => {
      const recommendations = recommend(db, request.params.id, request.query.limit);
      if (recommendations === null) {
        return reply.code(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `User ${request.params.id} not found`,
        });
      }
      return { user_id: request.params.id, recommendations };
    },
  );

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(DEFAULT_DB_PATH)) {
    console.error("Database not found. Run `npm run seed` first.");
    process.exit(1);
  }
  const app = buildApp(openDb(DEFAULT_DB_PATH, { readonly: true }), { logger: true });
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: "127.0.0.1" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
