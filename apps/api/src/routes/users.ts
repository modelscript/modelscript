/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

export function usersRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/users/suggestions
   */
  router.get("/suggestions", (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 3;
    const currentUserId = req.user?.id;
    const suggestions = database.getUserSuggestions(currentUserId, limit);
    res.json({ suggestions });
  });

  /**
   * GET /api/v1/users/me/topics
   */
  router.get("/me/topics", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const topics = database.getUserTopics(userId);
    res.json({ topics });
  });

  /**
   * PUT /api/v1/users/me/topics
   */
  router.put("/me/topics", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { concept, is_active } = req.body;
    if (!concept || is_active === undefined) {
      res.status(400).json({ error: "Missing concept or is_active" });
      return;
    }
    database.updateUserTopic(userId, concept, is_active);
    res.json({ success: true });
  });

  /**
   * GET /api/v1/users/:username
   */
  router.get("/:username", (req: Request, res: Response) => {
    const username = req.params.username as string;
    const profile = database.getFullProfileByUsername(username);

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check if the current user follows this profile (if authenticated)
    let isFollowing = false;
    const currentUserId = req.user?.id;
    if (currentUserId && currentUserId !== profile.id) {
      isFollowing = database.isFollowing(currentUserId, profile.id);
    }

    const linkedAccounts = database.getPublicOAuthAccounts(profile.id);

    res.json({ profile, isFollowing, linkedAccounts });
  });

  /**
   * GET /api/v1/users/:username/following
   */
  router.get("/:username/following", (req: Request, res: Response) => {
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentUserId = req.user?.id;
    const following = database.getUserFollowing(targetUser.id, currentUserId);
    res.json({ following });
  });

  /**
   * GET /api/v1/users/:username/followers
   */
  router.get("/:username/followers", (req: Request, res: Response) => {
    const targetUser = database.getUserByUsername(req.params.username as string);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentUserId = req.user?.id;
    const followers = database.getUserFollowers(targetUser.id, currentUserId);
    res.json({ followers });
  });

  /**
   * PUT /api/v1/users/me
   */
  router.put("/me", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { display_name, bio, location, website, avatar_url, banner_url } = req.body;

    database.updateProfile(userId, { display_name, bio, location, website, avatar_url, banner_url });
    res.json({ success: true });
  });

  /**
   * POST /api/v1/users/:username/follow
   */
  router.post("/:username/follow", requireAuth, (req: Request, res: Response) => {
    const followerId = req.user!.id;
    const username = req.params.username as string;

    const targetUser = database.getUserByUsername(username);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (followerId === targetUser.id) {
      res.status(400).json({ error: "Cannot follow yourself" });
      return;
    }

    database.followUser(followerId, targetUser.id);
    res.json({ success: true });
  });

  /**
   * DELETE /api/v1/users/:username/follow
   */
  router.delete("/:username/follow", requireAuth, (req: Request, res: Response) => {
    const followerId = req.user!.id;
    const username = req.params.username as string;

    const targetUser = database.getUserByUsername(username);
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    database.unfollowUser(followerId, targetUser.id);
    res.json({ success: true });
  });

  /**
   * GET /api/v1/users/me/bots
   */
  router.get("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const bots = database.getUserBots(userId);
    res.json({ bots });
  });

  /**
   * POST /api/v1/users/me/bots
   */
  router.post("/me/bots", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { username, display_name, bio, avatar_url } = req.body;

    if (!username || !display_name) {
      res.status(400).json({ error: "Missing username or display_name" });
      return;
    }

    if (database.getUserByUsername(username)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    // Generate a secure API token for the bot
    const crypto = require("crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenPrefix = "ms_bot_";
    const fullToken = `${tokenPrefix}${rawToken}`;

    // Hash the token before storing
    const tokenHash = crypto.createHash("sha256").update(fullToken).digest("hex");

    const bot = database.createBot(userId, username, display_name, bio || "", avatar_url || "", tokenHash);

    res.json({ success: true, bot, token: fullToken });
  });

  /**
   * DELETE /api/v1/users/me/bots/:botId
   */
  router.delete("/me/bots/:botId", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const botId = parseInt(req.params.botId as string, 10);

    if (isNaN(botId)) {
      res.status(400).json({ error: "Invalid bot ID" });
      return;
    }

    database.deleteBot(userId, botId);
    res.json({ success: true });
  });

  return router;
}
