// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * npm-compatible authentication routes.
 *
 * Implements the CouchDB-style user endpoint that `npm login` and `npm adduser`
 * use to register users and obtain tokens.
 *
 * npm login sends: PUT /-/user/org.couchdb.user:{username}
 *   body: { name, password, email }
 *   Expects: { ok: true, token: "..." }
 */

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET } from "../middleware/auth-middleware.js";
import { defaultRegistrationLimiter } from "../middleware/registration-limiter.js";
import { defaultMailer } from "../services/mailer.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { isDisposableEmail } from "../util/email-filter.js";
import { signEmailVerificationToken } from "../util/email-verification.js";

export function npmAuthRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * PUT /-/user/org.couchdb.user:{username}
   *
   * Called by `npm login` and `npm adduser`.
   * If the user exists, verify password and return a token.
   * If the user doesn't exist, create the account and return a token.
   */
  router.put(
    "/-/user/org.couchdb.user\\::username",
    enforceExportCompliance(() => database),
    async (req: Request, res: Response): Promise<void> => {
      const username = req.params["username"];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = req.body as any;
      const { name, password, email } = body;

      const effectiveUsername = username || name;

      if (!effectiveUsername || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      try {
        // Check if user exists
        const existing = database.getUserByUsername(effectiveUsername);

        if (existing) {
          // Verify password
          const fullUser = database.getUserByEmail(existing.email);
          if (!fullUser) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
          }

          const valid = await bcrypt.compare(password, fullUser.password_hash);
          if (!valid) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
          }

          // Return a token
          const token = jwt.sign(
            {
              id: fullUser.id,
              username: fullUser.username,
              email: fullUser.email,
              tokenVersion: fullUser.token_version ?? 1,
            },
            JWT_SECRET,
            {
              expiresIn: "30d",
            },
          );

          res.status(201).json({
            ok: true,
            id: `org.couchdb.user:${effectiveUsername}`,
            token,
          });
          return;
        }

        // Create new user with hardened anti-Sybil restrictions
        if (!email) {
          res.status(400).json({ error: "Email is required for registration" });
          return;
        }

        const clientIp =
          (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
        const rateCheck = defaultRegistrationLimiter.check(clientIp);
        if (!rateCheck.allowed) {
          res.status(429).json({
            error: "Too many registration attempts. Please try again later.",
            retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
          });
          return;
        }

        if (isDisposableEmail(email)) {
          res.status(403).json({
            error: "Disposable and temporary email addresses are not permitted. Please use a permanent email address.",
          });
          return;
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = database.createUser(effectiveUsername, email, passwordHash, {
          emailVerified: false,
          initialCredits: 0.0,
          status: "pending_verification",
          termsAcceptedAt: new Date().toISOString(),
          registrationIp: clientIp,
        });

        defaultRegistrationLimiter.record(clientIp);

        const verificationToken = signEmailVerificationToken(user.id, user.email);
        try {
          await defaultMailer.sendVerificationEmail(user.email, user.username, verificationToken);
        } catch (err) {
          console.error("[npm-auth] Failed to dispatch verification email:", err);
        }

        const token = jwt.sign(
          { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
          JWT_SECRET,
          {
            expiresIn: "30d",
          },
        );

        res.status(201).json({
          ok: true,
          id: `org.couchdb.user:${effectiveUsername}`,
          token,
          verificationRequired: true,
          message: "Account created. Please verify your email address to unlock free compute credits.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        res.status(500).json({ error: message });
      }
    },
  );

  /**
   * GET /-/whoami
   *
   * Called by `npm whoami` to verify the current authentication.
   */
  router.get("/-/whoami", (req: Request, res: Response): void => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
      res.json({ username: decoded.username });
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  /**
   * GET /-/ping
   *
   * Health check endpoint used by npm.
   */
  router.get("/-/ping", (_req: Request, res: Response): void => {
    res.json({});
  });

  return router;
}
