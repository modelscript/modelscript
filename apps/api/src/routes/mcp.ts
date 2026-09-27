// SPDX-License-Identifier: AGPL-3.0-or-later

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createModelScriptMcpServer, type ServerContext } from "@modelscript/mcp";
import crypto from "crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";
import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET } from "../middleware/auth-middleware.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";

interface ActiveSession {
  transport: SSEServerTransport;
  server: ReturnType<typeof createModelScriptMcpServer>;
  ctx: ServerContext;
  userId: number;
}

export function mcpRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const sessions = new Map<string, ActiveSession>();

  function resolveAuth(req: Request): number | null {
    let token: string | undefined;
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.query?.token && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (token) {
      if (token.startsWith("ms_bot_")) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const botUser = database.getUserByBotTokenHash(tokenHash);
        if (botUser) return botUser.id;
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded?.id) {
          const u = database.getUserById(decoded.id);
          if (u) return u.id;
        }
      } catch {
        return null;
      }
    }

    return resolveRequestUserId(req, database);
  }

  // GET /api/v1/mcp/sse — SSE handshake for MCP clients (Cursor, Claude Desktop, autonomous agents)
  router.get("/mcp/sse", async (req: Request, res: Response) => {
    const userId = resolveAuth(req);
    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
        message:
          "Valid authentication token required to connect to hosted MCP gateway. Pass Authorization header or '?token=<token>'.",
      });
      return;
    }

    const ctx: ServerContext = {
      current: null,
      userId,
      checkQuota: async ({ profile = "standard" }) => {
        const q = checkComputeQuota(userId, profile, database);
        return {
          allowed: q.allowed,
          reason: q.reason,
          balance: q.userBalance,
          required: q.estimatedCost,
          profileId: q.profileId,
        };
      },
      deductCredits: async ({ costCredits, toolName, details }) => {
        if (costCredits > 0) {
          database.deductUserCredits(userId, costCredits, null, `Hosted MCP: ${toolName}`, details);
        }
      },
    };

    const transport = new SSEServerTransport("/api/v1/mcp/messages", res);
    const mcpServer = createModelScriptMcpServer(ctx);

    const sessionId = transport.sessionId;
    sessions.set(sessionId, { transport, server: mcpServer, ctx, userId });

    req.on("close", () => {
      sessions.delete(sessionId);
    });

    await mcpServer.connect(transport);
  });

  // POST /api/v1/mcp/messages — Incoming JSON-RPC calls for an active SSE session
  router.post("/mcp/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handlePostMessage(req, res);
  });

  return router;
}
