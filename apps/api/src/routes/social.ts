/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import { extractTopics } from "../util/extract-topics.js";

// OptionalAuth middleware to allow endpoints to work for both logged in and out users
const optionalAuth = (req: Request, res: Response, next: any) => {
  if (req.headers.authorization) {
    return requireAuth(req, res, next);
  }
  next();
};

export function socialRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/social/posts
   */
  router.post("/posts", requireAuth, (req: Request, res: Response) => {
    const authorId = req.user!.id;
    const { content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id } = req.body;

    if (!content && !repost_of_id && !artifact_view_id) {
      res.status(400).json({ error: "Content, artifact, or repost target is required" });
      return;
    }

    try {
      const { id } = database.createPost(authorId, content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id);
      const post = database.getPost(id, authorId);

      // Extract trending topics if content is present
      if (content) {
        // Run asynchronously so it doesn't block the request
        setTimeout(() => {
          try {
            const author = database.getUserById(authorId);
            if (author) {
              const profile = database.getFullProfileByUsername(author.username);
              const followerCount = profile?.follower_count || 0;
              const postWeight = 1.0 + Math.log10(followerCount + 1) * 0.5;

              const topics = extractTopics(content);
              for (const topic of topics) {
                const topicId = database.updateTopicScore(topic.concept, topic.displayName, postWeight);
                database.linkPostToTopic(id, topicId);
              }
            }
          } catch (e) {
            console.error("Failed to process trending topics for post", id, e);
          }
        }, 0);
      }

      res.status(201).json({ post });
    } catch (err) {
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id
   */
  router.get("/posts/:id", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const currentUserId = req.user?.id;
    try {
      database.incrementPostView(postId);
      const post = database.getPost(postId, currentUserId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      res.json({ post });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch post" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/view
   */
  router.post("/posts/:id/view", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    try {
      database.incrementPostView(postId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to increment view" });
    }
  });
  /**
   * GET /api/v1/social/posts/:id/replies
   */
  router.get("/posts/:id/replies", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 50;
    try {
      const posts = database.getReplies(postId, currentUserId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch replies" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/parents
   */
  router.get("/posts/:id/parents", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const currentUserId = req.user?.id;
    try {
      const posts = database.getPostParents(postId, currentUserId);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch parents" });
    }
  });

  /**
   * GET /api/v1/social/timeline
   */
  router.get("/timeline", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query.limit) || 20;
    try {
      const posts = database.getHomeTimeline(userId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get timeline" });
    }
  });

  /**
   * GET /api/v1/social/users/:username/posts
   */
  router.get("/users/:username/posts", optionalAuth, (req: Request, res: Response) => {
    const username = req.params.username as string;
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 20;

    try {
      const posts = database.getUserTimeline(username, currentUserId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get user timeline" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/like
   */
  router.post("/posts/:id/like", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params.id);
    try {
      const liked = database.toggleLike(userId, postId);
      res.json({ liked });
    } catch (err) {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/bookmark
   */
  router.post("/posts/:id/bookmark", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params.id);
    try {
      const bookmarked = database.toggleBookmark(userId, postId);
      res.json({ bookmarked });
    } catch (err) {
      res.status(500).json({ error: "Failed to toggle bookmark" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/repost
   */
  router.post("/posts/:id/repost", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params.id);
    try {
      const reposted = database.toggleRepost(userId, postId);
      res.json({ reposted });
    } catch (err) {
      res.status(500).json({ error: "Failed to toggle repost" });
    }
  });

  /**
   * GET /api/v1/social/artifact-views/:id
   */
  router.get("/artifact-views/:id", optionalAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    try {
      const artifactView = database.getArtifactView(id);
      if (!artifactView) {
        res.status(404).json({ error: "Artifact view not found" });
        return;
      }
      res.json({ artifactView });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch artifact view" });
    }
  });

  /**
   * POST /api/v1/social/artifact-views
   */
  router.post("/artifact-views", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { artifact_type, view_config, title } = req.body;
    try {
      const id = database.createArtifactView(userId, artifact_type, "upload", view_config, title);
      res.status(201).json({ id });
    } catch (err) {
      res.status(500).json({ error: "Failed to create artifact view" });
    }
  });

  /**
   * GET /api/v1/social/bookmarks
   */
  router.get("/bookmarks", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query.limit) || 20;
    try {
      const posts = database.getBookmarks(userId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  /**
   * GET /api/v1/social/notifications
   */
  router.get("/notifications", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query.limit) || 20;
    try {
      const notifications = database.getNotifications(userId, limit);
      const unreadCount = database.getUnreadNotificationCount(userId);
      res.json({ notifications, unreadCount });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  /**
   * POST /api/v1/social/notifications/read
   */
  router.post("/notifications/read", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
      database.markNotificationsRead(userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark notifications read" });
    }
  });

  /**
   * GET /api/v1/social/trending
   */
  router.get("/trending", optionalAuth, (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 10;
    try {
      const topics = database.getTopTrendingTopics(limit);
      res.json({ topics });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch trending topics" });
    }
  });

  /**
   * GET /api/v1/social/topics/:concept/posts
   */
  router.get("/topics/:concept/posts", optionalAuth, (req: Request, res: Response) => {
    const concept = req.params.concept as string;
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 20;

    try {
      const posts = database.getTopicPosts(concept, currentUserId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get topic posts" });
    }
  });

  return router;
}
