// SPDX-License-Identifier: AGPL-3.0-or-later

import rateLimit from "express-rate-limit";
import { resolveRateLimitStore } from "./redis-store.js";

export { MinimalRedisClient, RedisRateLimitStore, resolveRateLimitStore } from "./redis-store.js";

/**
 * Standard API rate limiter middleware to protect routes against brute-force and DoS attacks.
 * Configured with test-bypass support, distributed Redis store support, and generous allowance
 * suitable for SPA + API polling.
 */
export const defaultApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env["RATE_LIMIT_MAX"]) || (process.env["NODE_ENV"] === "test" ? 100000 : 10000),
  store: resolveRateLimitStore("rl:api:"),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true") ||
    req.path === "/health" ||
    req.path.startsWith("/thumbnails") ||
    req.path.startsWith("/api/thumbnails") ||
    req.path.startsWith("/uploads") ||
    req.path.startsWith("/vscode-static") ||
    req.path.startsWith("/static") ||
    req.path.startsWith("/api/models") ||
    req.path.endsWith("/icon.svg") ||
    req.path.endsWith("/diagram.svg") ||
    req.path.endsWith("/icons"),
  message: { error: "Too many requests, please try again later." },
});

/**
 * Strict authentication rate limiter (e.g. login, token issuance, registration)
 * to defend against credential stuffing and brute-force password cracking.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env["AUTH_RATE_LIMIT_MAX"]) || (process.env["NODE_ENV"] === "test" ? 100000 : 60),
  store: resolveRateLimitStore("rl:auth:"),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true",
  message: { error: "Too many authentication attempts, please try again later." },
});

/**
 * Compute-intensive simulation rate limiter to prevent cluster queue flooding.
 */
export const simulateRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env["SIM_RATE_LIMIT_MAX"]) || (process.env["NODE_ENV"] === "test" ? 100000 : 30),
  store: resolveRateLimitStore("rl:sim:"),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true",
  message: { error: "Simulation dispatch rate limit exceeded. Please wait before submitting more jobs." },
});
