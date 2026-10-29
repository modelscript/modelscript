// SPDX-License-Identifier: AGPL-3.0-or-later

import rateLimit from "express-rate-limit";

/**
 * Standard API rate limiter middleware to protect routes against brute-force and DoS attacks.
 * Configured with test-bypass support and generous allowance suitable for SPA + API polling.
 */
export const defaultApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env["RATE_LIMIT_MAX"]) || (process.env["NODE_ENV"] === "test" ? 100000 : 1000),
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
    req.path.startsWith("/api/models"),
  message: { error: "Too many requests, please try again later." },
});
