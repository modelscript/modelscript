// SPDX-License-Identifier: AGPL-3.0-or-later

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createModelScriptMcpServer, type ServerContext } from "@modelscript/mcp";
import crypto from "crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";
import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, isAccountBlocked } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";

const MAX_MCP_SESSIONS = 200;

interface ActiveSession {
  transport: SSEServerTransport;
  server: ReturnType<typeof createModelScriptMcpServer>;
  ctx: ServerContext;
  userId: number;
}

export function mcpRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  router.use(defaultApiLimiter);
  const sessions = new Map<string, ActiveSession>();

  function resolveAuth(req: Request): number | null {
    let token: string | undefined;
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.query?.["token"] && typeof req.query["token"] === "string") {
      token = req.query["token"];
    }

    if (token) {
      if (token.startsWith("ms_bot_")) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const botUser = database.getUserByBotTokenHash(tokenHash);
        if (botUser && !isAccountBlocked(botUser.status)) return botUser.id;
        return null;
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as
          | {
              id?: number | undefined;
              scope?: string | undefined;
              purpose?: string | undefined;
              tokenVersion?: number | undefined;
            }
          | string;
        if (
          typeof decoded === "object" &&
          decoded !== null &&
          decoded.id &&
          decoded.scope !== "2fa_challenge" &&
          decoded.purpose !== "2fa_challenge"
        ) {
          const u = database.getUserById(decoded.id);
          if (u && !isAccountBlocked(u.status) && (decoded.tokenVersion ?? 1) === (u.token_version ?? 1)) {
            return u.id;
          }
        }
        return null;
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

    if (sessions.size >= MAX_MCP_SESSIONS) {
      res.status(429).json({
        error: "Too many active MCP sessions. Please close unused connections and try again.",
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
      socialBridge: {
        getPost: async (postId: number) => {
          return database.getPost(postId, userId);
        },
        getReplies: async (postId: number) => {
          return database.getReplies(postId, userId);
        },
        createPost: async (params) => {
          const user = database.getUserById(params.authorId);
          if (user?.account_type === "bot") {
            const bot = database.getBotById(params.authorId);
            const scopes = (bot?.bot_scopes || "").split(",").map((s) => s.trim());
            if (!scopes.includes("social:write")) {
              throw new Error("Bot lacks social:write scope");
            }
          }
          return database.createPost(params.authorId, params.content, params.artifactViewId, params.replyToId);
        },
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
    const sessionId = req.query["sessionId"] as string;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handlePostMessage(req, res);
  });

  return router;
}
