/* eslint-disable */
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

      const { password_hash: _, github_token, gitlab_token, ...safeUser } = user as any;

      res.status(201).json({
        token,
        user: safeUser,
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

      const { password_hash: _, github_token, gitlab_token, ...safeUser } = user as any;

      res.json({
        token,
        user: safeUser,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/auth/login/:provider
   */
  router.get("/login/:provider", (req: Request, res: Response) => {
    const { provider } = req.params;
    // Mock OAuth flow: Redirect to provider, which would normally redirect back to callback
    res.redirect(`/api/v1/auth/callback/${provider}?code=mock_code_from_${provider}`);
  });

  /**
   * GET /api/v1/auth/callback/:provider
   */
  router.get("/callback/:provider", (req: Request, res: Response) => {
    const provider = req.params.provider as string;
    // Mock OAuth flow: exchange code for profile
    const mockEmail = `mockuser@${provider}.com`;
    const mockUsername = `mockuser_${provider}`;
    const mockProviderUserId = `12345_${provider}`;

    try {
      let oauthAcc = database.getOAuthAccount(provider, mockProviderUserId);
      let userId = oauthAcc?.user_id;
      let user;

      if (userId) {
        user = database.getUserById(userId);
      } else {
        // Ensure email/username are not already taken by a regular account
        const existing = database.getUserByEmail(mockEmail);
        if (existing) {
          user = existing;
        } else {
          user = database.createOAuthUser(mockUsername, mockEmail, provider, mockProviderUserId);
        }
      }

      if (!user) {
        res.redirect(`http://localhost:3000/login?error=OAuthFailed`);
        return;
      }

      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      // Redirect back to the frontend SPA
      res.redirect(`http://localhost:3000/oauth/callback?token=${token}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`http://localhost:3000/login?error=OAuthFailed`);
    }
  });

  /**
   * GET /api/v1/auth/me
   */
  router.get("/me", requireAuth, (req: Request, res: Response): void => {
    try {
      const user = database.getUserById(req.user!.id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const { password_hash, github_token, gitlab_token, ...safeUser } = user as any;
      res.json({ user: safeUser });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  /**
   * PUT /api/v1/auth/account
   */
  router.put("/account", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { password, username, email, display_name, avatar_url, banner_url } = req.body;
    const userId = req.user!.id;

    if (!password) {
      res.status(400).json({ error: "Password is required to confirm changes" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      if (!hash || !(await bcrypt.compare(password, hash))) {
        res.status(401).json({ error: "Incorrect password" });
        return;
      }

      if (username || email) {
        const u = username || req.user!.username;
        const e = email || req.user!.email;

        // check uniqueness if changed
        if (u !== req.user!.username) {
          const existU = database.getUserByUsername(u);
          if (existU) {
            res.status(409).json({ error: "Username is taken" });
            return;
          }
        }
        if (e !== req.user!.email) {
          const existE = database.getUserByEmail(e);
          if (existE) {
            res.status(409).json({ error: "Email is taken" });
            return;
          }
        }

        database.updateAccount(userId, u, e);
      }

      database.updateProfile(userId, {
        display_name,
        avatar_url,
        banner_url,
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
    }
  });

  /**
   * PUT /api/v1/auth/password
   */
  router.put("/password", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user!.id;

    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: "Both old and new passwords are required" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      if (!hash || !(await bcrypt.compare(oldPassword, hash))) {
        res.status(401).json({ error: "Incorrect old password" });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      database.updatePassword(userId, newHash);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Password change failed" });
    }
  });

  /**
   * GET /api/v1/auth/notifications
   */
  router.get("/notifications", requireAuth, (req: Request, res: Response): void => {
    try {
      const settingsStr = database.getNotificationSettings(req.user!.id);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch notification settings" });
    }
  });

  /**
   * PUT /api/v1/auth/notifications
   */
  router.put("/notifications", requireAuth, (req: Request, res: Response): void => {
    try {
      const settingsStr = JSON.stringify(req.body);
      database.updateNotificationSettings(req.user!.id, settingsStr);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update notification settings" });
    }
  });

  return router;
}
