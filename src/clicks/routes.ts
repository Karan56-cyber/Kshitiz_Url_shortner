import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireWorkspaceRole } from "../auth/routes.js";
import type { AuthRepository } from "../auth/types.js";
import {
  AnalyticsService,
  InvalidAnalyticsRangeError,
} from "./service.js";
import type { AnalyticsRepository } from "./types.js";

interface AnalyticsRouteOptions {
  repository: AnalyticsRepository;
  authRepository: AuthRepository;
}

const paramsSchema = z.object({ workspaceId: z.string().min(1) });
const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

function errorResponse(reply: FastifyReply) {
  return reply.code(400).send({
    error: "Bad Request",
    message: "Request validation failed",
  });
}

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  options: AnalyticsRouteOptions,
): void {
  const service = new AnalyticsService(options.repository);
  const workspaceAccess = [
    authenticate,
    requireWorkspaceRole(options.authRepository),
  ];

  app.get(
    "/workspaces/:workspaceId/analytics/overview",
    { preHandler: workspaceAccess },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!params.success || !query.success) return errorResponse(reply);
      try {
        return await service.overview(params.data.workspaceId, query.data);
      } catch (error) {
        if (error instanceof InvalidAnalyticsRangeError) return errorResponse(reply);
        throw error;
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/analytics/links",
    { preHandler: workspaceAccess },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!params.success || !query.success) return errorResponse(reply);
      try {
        return await service.links(params.data.workspaceId, query.data);
      } catch (error) {
        if (error instanceof InvalidAnalyticsRangeError) return errorResponse(reply);
        throw error;
      }
    },
  );
}
