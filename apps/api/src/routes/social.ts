/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import Parser from "rss-parser";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import { locationService } from "../services/location.js";
import { extractTopics } from "../util/extract-topics.js";
import { generateThumbnail } from "../workers/thumbnailWorker.js";

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
    const {
      content,
      artifact_view_id,
      reply_to_id,
      quote_post_id,
      repost_of_id,
      client_signature,
      key_id_string,
      metadata,
      reply_visibility,
    } = req.body;

    if (!content && !repost_of_id && !artifact_view_id) {
      res.status(400).json({ error: "Content, artifact, or repost target is required" });
      return;
    }

    try {
      if (reply_to_id) {
        const parentPost = database.getPost(reply_to_id, authorId);
        if (!parentPost) {
          res.status(404).json({ error: "Parent post not found" });
          return;
        }

        const author = database.getUserById(authorId);

        if (parentPost.reply_visibility === "following") {
          // The author of the parent post must follow the person replying
          // Wait, is parentPost.author_id accessible? Yes.
          // Or if they are the same user, it's allowed.
          if (parentPost.author_id !== authorId) {
            const isFollowedByAuthor = database.isFollowing(parentPost.author_id, authorId);
            if (!isFollowedByAuthor) {
              res.status(403).json({ error: "Only people the author follows can reply" });
              return;
            }
          }
        } else if (parentPost.reply_visibility === "mentioned") {
          if (parentPost.author_id !== authorId && author) {
            const mentionRegex = new RegExp(`@${author.username}\\b`, "i");
            if (!mentionRegex.test(parentPost.content || "")) {
              res.status(403).json({ error: "Only accounts mentioned in the post can reply" });
              return;
            }
          }
        }
      }
      const { id } = database.createPost(
        authorId,
        content,
        artifact_view_id,
        reply_to_id,
        quote_post_id,
        repost_of_id,
        undefined,
        undefined,
        undefined,
        undefined,
        metadata ? JSON.stringify(metadata) : undefined,
        reply_visibility,
      );
      const post = database.getPost(id, authorId);

      // Process tasks asynchronously so they don't block the request
      setTimeout(() => {
        try {
          // Create notification for reply
          if (reply_to_id) {
            const parentPost = database.getPost(reply_to_id);
            if (parentPost && parentPost.author_id) {
              database.createNotification(parentPost.author_id, authorId, "reply", id);
            }
          }

          // Broadcast to remote followers via ActivityPub
          (async () => {
            try {
              const fullAuthor = database.db
                .prepare(`SELECT rsa_private_key, actor_url FROM users WHERE id = ?`)
                .get(authorId) as Record<string, unknown> | undefined;

              if (fullAuthor && content) {
                // Find remote followers
                const remoteFollowers = database.db
                  .prepare(
                    `
                  SELECT u.inbox_url 
                  FROM follows f
                  JOIN users u ON f.follower_id = u.id
                  WHERE f.following_id = ? AND u.remote_domain IS NOT NULL
                `,
                  )
                  .all(authorId) as Array<{ inbox_url: string }>;

                if (remoteFollowers.length > 0) {
                  const apPostId = `${fullAuthor.actor_url}/posts/${id}`;

                  const noteObject: any = {
                    id: apPostId,
                    type: "Note",
                    published: new Date().toISOString(),
                    attributedTo: fullAuthor.actor_url,
                    content: content,
                    to: ["https://www.w3.org/ns/activitystreams#Public"],
                    cc: [`${fullAuthor.actor_url}/followers`],
                  };

                  if (client_signature && key_id_string) {
                    noteObject.proof = {
                      type: "RsaSignature2017",
                      creator: `${fullAuthor.actor_url}#${key_id_string}`,
                      created: new Date().toISOString(),
                      signatureValue: client_signature,
                    };
                  }

                  const createActivity = {
                    "@context": "https://www.w3.org/ns/activitystreams",
                    id: `${apPostId}/activity`,
                    type: "Create",
                    actor: fullAuthor.actor_url,
                    published: new Date().toISOString(),
                    to: ["https://www.w3.org/ns/activitystreams#Public"],
                    cc: [`${fullAuthor.actor_url}/followers`],
                    object: noteObject,
                  };

                  const { sendSignedRequest } = await import("../util/activitypub-crypto.js");

                  // Use instance key for HTTP transport signature, falling back to legacy rsa_private_key
                  const instanceKeys = database.getInstanceKeys();
                  const transportKey = instanceKeys.privateKey;
                  const transportKeyId = `${process.env.PUBLIC_URL || "https://hub.modelscript.org"}/actor#main-key`;

                  for (const follower of remoteFollowers) {
                    if (follower.inbox_url) {
                      sendSignedRequest(follower.inbox_url, createActivity, transportKeyId, transportKey).catch((err) =>
                        console.error("Failed to broadcast to", follower.inbox_url, err),
                      );
                    }
                  }
                }
              }
            } catch (err) {
              console.error("Failed to broadcast ActivityPub post", err);
            }
          })();

          if (content) {
            const author = database.getUserById(authorId);
            if (author) {
              const profile = database.getFullProfileByUsername(author.username);
              const followerCount = profile?.follower_count || 0;
              const location = profile?.location || null;
              const postWeight = 1.0 + Math.log10(followerCount + 1) * 0.5;

              const topics = extractTopics(content);
              for (const topic of topics) {
                const topicId = database.updateTopicScore(topic.concept, topic.displayName, postWeight, 24, location);
                database.linkPostToTopic(id, topicId);
              }

              // Extract mentions and create notifications
              const mentionRegex = /(?:^|\s)@([a-zA-Z0-9_]+)/g;
              let match;
              const mentions = new Set<string>();
              while ((match = mentionRegex.exec(content)) !== null) {
                if (match[1]) {
                  mentions.add(match[1]);
                }
              }
              for (const username of mentions) {
                const mentionedUser = database.getUserByUsername(username);
                if (mentionedUser) {
                  database.createNotification(mentionedUser.id, authorId, "mention", id);
                }
              }

              // Extract URLs for link previews (if no artifact exists)
              if (!artifact_view_id) {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const urlMatch = urlRegex.exec(content);
                if (urlMatch && urlMatch[1]) {
                  const url = urlMatch[1];
                  // Fire and forget
                  (async () => {
                    try {
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 3000);
                      const res = await fetch(url, {
                        signal: controller.signal,
                        headers: { "User-Agent": "ModelScriptBot/1.0" },
                      });
                      clearTimeout(timeoutId);
                      if (res.ok) {
                        const html = await res.text();

                        let title = "";
                        let description = "";
                        let image = "";

                        const titleMatch =
                          html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                          html.match(/<title[^>]*>([^<]+)<\/title>/i);
                        if (titleMatch) title = titleMatch[1] || "";

                        const descMatch =
                          html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
                        if (descMatch) description = descMatch[1] || "";

                        const imgMatch = html.match(
                          /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
                        );
                        if (imgMatch) image = imgMatch[1] || "";

                        if (title) {
                          const domain = new URL(url).hostname;
                          const viewConfig = JSON.stringify({ url, domain, title, description, image });
                          const newArtifactId = database.createArtifactView(
                            authorId,
                            "link-preview",
                            "url",
                            viewConfig,
                            title,
                          );
                          database.updatePostArtifactViewId(id, newArtifactId);
                        }
                      }
                    } catch (err) {
                      // Ignore fetch errors
                    }
                  })();
                }
              }
            }
          }
        } catch (e) {
          console.error("Failed to process post tasks for post", id, e);
        }
      }, 0);

      res.status(201).json({ post });
    } catch (err) {
      console.error("POST /posts error:", err);
      res.status(500).json({ error: "Failed to create post", details: String(err) });
    }
  });

  /**
   * GET /api/v1/social/posts/:id
   */
  router.get("/posts/:id", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const currentUserId = req.user?.id;
    try {
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
      const ip = locationService.extractIp(req);
      const loc = locationService.lookupIp(ip);

      let countryCode = loc?.countryCode;
      let regionCode = loc?.regionCode;

      if (!countryCode && req.user) {
        const user = database.getUserById(req.user.id);
        if (user) {
          const profile = database.getFullProfileByUsername(user.username);
          if (profile?.location) {
            // Try to extract alpha-2 or alpha-3 from location string if needed,
            // but we'll just pass the string directly and let the frontend map handle it
            countryCode = profile.location.toUpperCase();
          }
        }
      }

      database.incrementPostView(postId, countryCode, regionCode);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to increment view" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/analytics
   */
  router.get("/posts/:id/analytics", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    try {
      const post = database.getPost(postId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      const locationStats = database.getPostLocationStats(postId);
      res.json({
        view_count: post.view_count,
        like_count: post.like_count,
        reply_count: post.reply_count,
        repost_count: post.repost_count,
        location_stats: locationStats,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch analytics" });
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
   * GET /api/v1/social/timeline/following
   */
  router.get("/timeline/following", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query.limit) || 20;
    const sort = req.query.sort as string;
    try {
      const posts = database.getFollowingTimeline(userId, limit, sort);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get following timeline" });
    }
  });

  /**
   * GET /api/v1/social/explore
   */
  router.get("/explore", optionalAuth, (req: Request, res: Response) => {
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 20;
    try {
      const posts = database.getExploreTimeline(currentUserId, limit);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get explore timeline" });
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

      // Asynchronously trigger thumbnail generation if applicable
      if (["simulation-result", "fea-result", "cfd-result", "cad-step", "cad_step"].includes(artifact_type)) {
        generateThumbnail(id).catch((err) => console.error("Error triggering thumbnail generation:", err));
      }

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

  /**
   * POST /api/v1/social/feeds/subscribe
   */
  router.post("/feeds/subscribe", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    try {
      let targetUrl = url;
      let customUsername: string | undefined;

      // 1. Detect if user typed @handle@youtube.com
      const handleMatch = url.match(/^(@[a-zA-Z0-9_-]+)@youtube\.com$/i);
      if (handleMatch) {
        const handle = handleMatch[1];
        try {
          const ytRes = await fetch(`https://www.youtube.com/${handle}`);
          const ytHtml = await ytRes.text();
          const idMatch = ytHtml.match(/channel_id=([^"&']+)/);
          if (idMatch && idMatch[1]) {
            targetUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`;
            customUsername = `yt:channel:${idMatch[1]}`;
          } else {
            res.status(400).json({ error: "Could not find YouTube channel for that handle" });
            return;
          }
        } catch (e) {
          res.status(500).json({ error: "Error contacting YouTube" });
          return;
        }
      } else if (url.includes("youtube.com/feeds/videos.xml?channel_id=")) {
        // 2. If they gave the URL directly, use the channel ID for the username
        const channelIdMatch = url.match(/channel_id=([^&]+)/);
        if (channelIdMatch && channelIdMatch[1]) {
          customUsername = `yt:channel:${channelIdMatch[1]}`;
        }
      } else if (url.startsWith("yt:channel:")) {
        // 3. If they directly input yt:channel:ID
        let channelId = url.replace("yt:channel:", "");
        if (channelId) {
          if (channelId.length === 22 && !channelId.startsWith("UC")) {
            channelId = `UC${channelId}`;
          }
          targetUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
          customUsername = `yt:channel:${channelId}`;
        }
      }

      // Check if it exists globally
      let feed = database.getRssFeedByUrl(targetUrl);

      if (!feed) {
        // Fetch metadata
        const parser = new Parser({
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            Accept:
              "application/rss+xml, application/rdf+xml;q=0.8, application/atom+xml;q=0.6, application/xml;q=0.4, text/xml;q=0.4, text/html;q=0.2, */*;q=0.1",
          },
        });
        const parsed = await parser.parseURL(targetUrl);

        const title = parsed.title || "Unknown Feed";
        const description = parsed.description || "";
        const siteUrl = parsed.link || targetUrl;
        let avatarUrl = parsed.image?.url;
        if (!avatarUrl && siteUrl && siteUrl.startsWith("http")) {
          try {
            const htmlRes = await fetch(siteUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (compatible; ModelScript/1.0)",
              },
            });
            const html = await htmlRes.text();
            const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            if (match && match[1]) {
              avatarUrl = match[1];
            }
          } catch (e) {
            console.error("Failed to fetch og:image for RSS avatar", e);
          }
        }
        avatarUrl =
          avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=random&color=fff`;

        const feedId = database.createRssProfile(targetUrl, title, description, siteUrl, avatarUrl, customUsername);
        feed = database.getRssFeedByUrl(targetUrl);
      }

      database.subscribeToRssFeed(userId, feed.id);

      // Trigger RSS worker asynchronously to fetch items right away
      import("../util/rss-worker.js")
        .then(({ processRssFeeds }) => {
          void processRssFeeds(database);
        })
        .catch(console.error);

      res.status(200).json({ success: true, feed });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || "Failed to subscribe to RSS feed" });
    }
  });

  /**
   * GET /api/v1/social/feeds
   */
  router.get("/feeds", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
      const feeds = database.getUserRssSubscriptions(userId);
      res.json({ feeds });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch feeds" });
    }
  });

  /**
   * DELETE /api/v1/social/feeds/:id/unsubscribe
   */
  router.delete("/feeds/:id/unsubscribe", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const feedId = Number(req.params.id);
    try {
      database.unsubscribeFromRssFeed(userId, feedId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to unsubscribe from feed" });
    }
  });

  return router;
}
