import type { Instrumentation } from "next";
import { logger } from "@/lib/logger";

// Todo erro não tratado do servidor (render, route handler, server action)
// vira um log estruturado com rota e digest — o digest é o mesmo id que o
// usuário vê na tela de erro, então dá pra achar a causa a partir do print.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  logger.error("request.error", err, {
    path: request.path.split("?")[0],
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    digest:
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest: unknown }).digest)
        : undefined,
  });
};
