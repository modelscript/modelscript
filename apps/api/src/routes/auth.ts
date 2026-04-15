// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, requireAuth } from "../middleware/auth-middleware.js";

export function authRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/auth/register
   */
  router.post("/register", async (req: Request, res: Response): Promise<void> => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: "Username, email, and password are required" });
      return;
    }

    if (typeof username !== "string" || username.length < 3) {
      res.status(400).json({ error: "Username must be at least 3 characters" });
      return;
    }

    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    try {
      const existing = database.getUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }

      const existingUsername = database.getUserByUsername(username);
      if (existingUsername) {
        res.status(409).json({ error: "This username is already taken" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = database.createUser(username, email, passwordHash);

      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.status(201).json({
        token,
        user: { id: user.id, username: user.username, email: user.email },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/auth/login
   */
  router.post("/login", async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    try {
      const user = database.getUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      res.json({
        token,
        user: { id: user.id, username: user.username, email: user.email },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/auth/me
   */
  router.get("/me", requireAuth, (req: Request, res: Response): void => {
    res.json({ user: req.user });
  });

  return router;
}
