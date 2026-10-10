// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "fs";
import path from "path";
import Parser from "rss-parser";
import type { LibraryDatabase } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { locationService } from "../services/location.js";
import { extractTopics } from "../util/extract-topics.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";
import { generateThumbnail } from "../workers/thumbnailWorker.js";

// OptionalAuth middleware to allow endpoints to work for both logged in and out users
const optionalAuth = (req: Request, res: Response, next: any) => {
  if (req.headers.authorization) {
    return requireAuth(req, res, next);
  }
  next();
};

export function socialRouter(database: LibraryDatabase, worker?: FederationWorker): Router {
  const router = createRouter();

  /**
   * POST /api/v1/social/posts
   */
  router.post("/posts", requireAuth, (req: Request, res: Response) => {
    const authorId = req.user!.id;
    const {
      content,
      artifact_view_id: raw_artifact_view_id,
      artifactId,
      reply_to_id,
      quote_post_id,
      repost_of_id,
      client_signature,
      key_id_string,
      metadata: rawMetadata,
      reply_visibility,
      content_warning,
    } = req.body;
    const artifact_view_id = raw_artifact_view_id ?? artifactId;
    const metadata = {
      ...(typeof rawMetadata === "object" && rawMetadata !== null ? rawMetadata : {}),
      ...(content_warning ? { contentWarning: content_warning } : {}),
    };

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

          // Extract mentions and create notifications
          const mentionRegex = /(?:^|\s)@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g;
          let match;
          const mentions = new Set<string>();
          if (content) {
            while ((match = mentionRegex.exec(content)) !== null) {
              if (match[1]) {
                mentions.add(match[1]);
              }
            }
          }

          // Broadcast to remote followers & mentioned actors via ActivityPub
          (async () => {
            try {
              const fullAuthor = database.getUserFederationInfo(authorId);

              if (fullAuthor && content) {
                // Find remote followers
                const remoteFollowers = database.getRemoteFollowersInboxes(authorId);
                const mentionTags: any[] = [];
                const additionalInboxes: { inbox_url: string; shared_inbox_url?: string; remote_domain: string }[] = [];

                for (const username of mentions) {
                  if (username.includes("@")) {
                    try {
                      const { resolveActorHandle } = await import("./federation.js");
                      const resolved = await resolveActorHandle(username, database);
                      if (resolved && resolved.user) {
                        database.createNotification(resolved.user.id, authorId, "mention", id);
                        if (resolved.actorUrl) {
                          mentionTags.push({
                            type: "Mention",
                            href: resolved.actorUrl,
                            name: `@${resolved.user.username}`,
                          });
                          const inbox =
                            (resolved.actor?.endpoints as any)?.sharedInbox ||
                            (resolved.actor?.sharedInbox as string) ||
                            (resolved.actor?.inbox as string) ||
                            `${resolved.actorUrl}/inbox`;
                          const domain = new URL(resolved.actorUrl).hostname;
                          additionalInboxes.push({
                            inbox_url: inbox,
                            shared_inbox_url:
                              (resolved.actor?.endpoints as any)?.sharedInbox ||
                              (resolved.actor?.sharedInbox as string) ||
                              undefined,
                            remote_domain: domain,
                          });
                        }
                      }
                    } catch {
                      // Ignore lookup errors for unresolvable remote handles
                    }
                  } else {
                    const mentionedUser = database.getUserByUsername(username);
                    if (mentionedUser) {
                      database.createNotification(mentionedUser.id, authorId, "mention", id);
                    }
                  }
                }

                if (remoteFollowers.length > 0 || additionalInboxes.length > 0) {
                  const apPostId = `${fullAuthor.actor_url}/posts/${id}`;
                  const ccList = [`${fullAuthor.actor_url}/followers`, ...mentionTags.map((m) => m.href)];

                  const noteObject: any = {
                    id: apPostId,
                    type: "Note",
                    published: new Date().toISOString(),
                    attributedTo: fullAuthor.actor_url,
                    content: content,
                    to: ["https://www.w3.org/ns/activitystreams#Public"],
                    cc: ccList,
                  };

                  if (content_warning || (metadata as any)?.contentWarning) {
                    noteObject.summary = content_warning || (metadata as any)?.contentWarning;
                  }

                  if (mentionTags.length > 0) {
                    noteObject.tag = mentionTags;
                  }

                  if (client_signature && key_id_string) {
                    noteObject.proof = {
                      type: "RsaSignature2017",
                      creator: `${fullAuthor.actor_url}#${key_id_string}`,
                      created: new Date().toISOString(),
                      signatureValue: client_signature,
                    };
                  }

                  if (artifact_view_id) {
                    const artifact = database.getArtifactView(artifact_view_id);
                    const { serializeArtifactAttachment } = await import("./federation.js");
                    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
                    const attachment = serializeArtifactAttachment(artifact, publicUrl);
                    if (attachment) {
                      noteObject.attachment = [attachment];
                    }
                  }

                  const createActivity = {
                    "@context": [
                      "https://www.w3.org/ns/activitystreams",
                      {
                        modelscript: "https://hub.modelscript.org/ns#",
                        viewType: "modelscript:viewType",
                        viewConfig: "modelscript:viewConfig",
                        sourceType: "modelscript:sourceType",
                      },
                    ],
                    id: `${apPostId}/activity`,
                    type: "Create",
                    actor: fullAuthor.actor_url,
                    published: new Date().toISOString(),
                    to: ["https://www.w3.org/ns/activitystreams#Public"],
                    cc: ccList,
                    object: noteObject,
                  };

                  const { FederationWorker } = await import("../services/federation-worker.js");
                  const fedWorker = worker || new FederationWorker(database);
                  fedWorker.enqueueActivityBroadcast(createActivity, authorId, additionalInboxes);
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

              // Extract URLs for link previews (if no artifact exists)
              if (!artifact_view_id) {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const urlMatch = urlRegex.exec(content);
                let safePreviewUrl: URL | null = null;
                if (urlMatch && urlMatch[1]) {
                  try {
                    safePreviewUrl = assertSafePublicUrl(urlMatch[1]);
                  } catch {
                    safePreviewUrl = null;
                  }
                }
                if (safePreviewUrl) {
                  const url = safePreviewUrl.href;
                  // Fire and forget
                  (async () => {
                    try {
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 3000);
                      const res = await safePublicFetch(url, {
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
   * DELETE /api/v1/social/posts/:id
   */
  router.delete("/posts/:id", requireAuth, async (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const userId = req.user!.id;

    try {
      const existingPost = database.getPost(postId);
      if (!existingPost) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      if (existingPost.author_id !== userId && req.user!.role !== "admin") {
        res.status(403).json({ error: "You can only delete your own posts" });
        return;
      }

      const deleteResult = database.deletePost(postId);
      if (!deleteResult.success) {
        res.status(404).json({ error: "Failed to delete post" });
        return;
      }

      // Outbound ActivityPub Delete Tombstone
      if (deleteResult.apId && deleteResult.authorId) {
        const fullAuthor = database.getUserFederationInfo(deleteResult.authorId);
        if (fullAuthor?.actor_url) {
          const tombstoneActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${deleteResult.apId}#delete`,
            type: "Delete",
            actor: fullAuthor.actor_url,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: [`${fullAuthor.actor_url}/followers`],
            object: {
              id: deleteResult.apId,
              type: "Tombstone",
            },
          };

          const { FederationWorker } = await import("../services/federation-worker.js");
          const fedWorker = worker || new FederationWorker(database);
          fedWorker.enqueueActivityBroadcast(tombstoneActivity, deleteResult.authorId);
        }
      }

      res.json({ success: true, postId });
    } catch (err: any) {
      console.error("DELETE /posts/:id error:", err);
      res.status(500).json({ error: err.message || "Failed to delete post" });
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
      // Check CDN headers first (Cloudflare, AWS CloudFront, Nginx reverse proxy)
      const cfCountry = req.headers["cf-ipcountry"] as string | undefined;
      const cfRegion = (req.headers["cf-region-code"] || req.headers["cf-region"]) as string | undefined;
      const xCountry = (req.headers["x-country-code"] || req.headers["x-country"]) as string | undefined;
      const xRegion = (req.headers["x-region-code"] || req.headers["x-region"]) as string | undefined;

      let countryCode = (cfCountry && cfCountry !== "XX" ? cfCountry : undefined) || xCountry;
      let regionCode = cfRegion || xRegion;

      if (!countryCode) {
        const ip = locationService.extractIp(req);
        const loc = locationService.lookupIp(ip);
        if (loc) {
          countryCode = loc.countryCode;
          regionCode = loc.regionCode;
        }
      }

      if (!countryCode && req.user) {
        const user = database.getUserById(req.user.id);
        if (user) {
          const profile = database.getFullProfileByUsername(user.username);
          if (profile?.location) {
            countryCode = profile.location.toUpperCase();
          }
        }
      }

      // Offline / Local development fallback so heat maps display correctly when testing locally
      if (!countryCode) {
        const ip = locationService.extractIp(req);
        if (
          ip === "127.0.0.1" ||
          ip === "::1" ||
          ip.startsWith("192.168.") ||
          ip.startsWith("10.") ||
          ip.startsWith("::ffff:127.")
        ) {
          countryCode = "US";
          regionCode = "CA";
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
      const regionStats = database.getPostRegionStats(postId);
      res.json({
        view_count: post.view_count,
        like_count: post.like_count,
        reply_count: post.reply_count,
        repost_count: post.repost_count,
        location_stats: locationStats,
        region_stats: regionStats,
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
    const offset = Number(req.query.offset) || 0;
    const artifactType = (req.query.artifactType as string) || undefined;
    const tag = (req.query.tag as string) || undefined;
    try {
      const posts = database.getHomeTimeline(userId, limit, offset, artifactType, tag);
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
    const offset = Number(req.query.offset) || 0;
    const artifactType = (req.query.artifactType as string) || undefined;
    const tag = (req.query.tag as string) || undefined;
    try {
      const posts = database.getFollowingTimeline(userId, limit, sort, offset, artifactType, tag);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get following timeline" });
    }
  });

  /**
   * GET /api/v1/social/timeline/federated
   */
  router.get("/timeline/federated", optionalAuth, (req: Request, res: Response) => {
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const artifactType = (req.query.artifactType as string) || undefined;
    const tag = (req.query.tag as string) || undefined;
    try {
      const posts = database.getFederatedTimeline(currentUserId, limit, offset, artifactType, tag);
      res.json({ posts });
    } catch (err) {
      res.status(500).json({ error: "Failed to get federated timeline" });
    }
  });

  /**
   * GET /api/v1/social/explore
   */
  router.get("/explore", optionalAuth, (req: Request, res: Response) => {
    const currentUserId = req.user?.id;
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const artifactType = (req.query.artifactType as string) || undefined;
    const tag = (req.query.tag as string) || undefined;
    try {
      const posts = database.getExploreTimeline(currentUserId, limit, offset, artifactType, tag);
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
    const type = req.query.type as string | undefined;

    try {
      const posts = database.getUserTimeline(username, currentUserId, limit, type);
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
   * POST /api/v1/social/posts/:id/report
   * Allows users to report abusive posts, illegal content, or copyright violations
   */
  router.post("/posts/:id/report", requireAuth, (req: Request, res: Response) => {
    const reporterId = req.user!.id;
    const postId = Number(req.params.id);
    const { reason, details } = req.body;

    if (!reason || typeof reason !== "string") {
      res.status(400).json({ error: "Report reason is required" });
      return;
    }

    try {
      const post = database.getPost(postId, reporterId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      const report = database.createContentReport(reporterId, {
        postId,
        targetUserId: post.author_id,
        reason,
        details,
      });

      database.logAudit({
        actorId: reporterId,
        action: "post_reported",
        resourceType: "post",
        resourceId: String(postId),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { reason, reportId: report.id },
      });

      res.status(201).json({
        success: true,
        reportId: report.id,
        status: report.status,
        message: "Report submitted successfully. Content will be reviewed by moderation.",
      });
    } catch (err: any) {
      console.error("POST /posts/:id/report error:", err);
      res.status(500).json({ error: err.message || "Failed to submit report" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/quotes
   */
  router.get("/posts/:id/quotes", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const userId = req.user?.id;
    try {
      const quotes = database.getQuotes(postId, userId);
      res.json({ quotes });
    } catch (err: any) {
      console.error("GET /posts/:id/quotes error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch quotes" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/reposts
   */
  router.get("/posts/:id/reposts", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params.id);
    const userId = req.user?.id;
    try {
      const reposts = database.getReposts(postId, userId);
      res.json({ reposts });
    } catch (err: any) {
      console.error("GET /posts/:id/reposts error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch reposts" });
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
   * PUT /api/v1/social/artifact-views/:id/thumbnail
   */
  router.put("/artifact-views/:id/thumbnail", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params["id"];
    const id = Number(Array.isArray(rawId) ? rawId[0] : rawId);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid artifact ID" });
      return;
    }

    const { dataUrl, image } = req.body;
    const rawData = dataUrl || image;
    if (!rawData || typeof rawData !== "string") {
      res.status(400).json({ error: "dataUrl or image string is required" });
      return;
    }

    try {
      const artifact = database.getArtifactView(id);
      if (!artifact) {
        res.status(404).json({ error: "Artifact view not found" });
        return;
      }

      // Extract base64
      const matches = rawData.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      const ext = matches ? (matches[1] === "jpeg" ? "jpg" : matches[1]) : "webp";
      const base64Data = matches ? matches[2]! : rawData.replace(/^data:.*?;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const outDir = path.resolve(process.cwd(), "apps/api/public/thumbnails");
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const filename = `artifact_${id}_thumb_${Date.now()}.${ext}`;
      const filePath = path.join(outDir, filename);
      fs.writeFileSync(filePath, buffer);

      const thumbnailUrl = `/thumbnails/${filename}`;
      database.updateArtifactThumbnail(id, thumbnailUrl);

      res.json({ success: true, thumbnailUrl });
    } catch (err: any) {
      console.error("[socialRouter] Error saving artifact thumbnail:", err);
      res.status(500).json({ error: "Failed to save thumbnail" });
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
   * POST /api/v1/social/artifact-views/from-hpc-job
   */
  router.post("/artifact-views/from-hpc-job", optionalAuth, (req: Request, res: Response) => {
    const userId = req.user?.id || 1;
    const { jobId, colormap, activeField, title } = req.body;

    if (!jobId) {
      return res.status(400).json({ error: "Missing required jobId parameter" });
    }

    try {
      const result = database.createArtifactViewFromJob(userId, Number(jobId), {
        colormap,
        activeField,
        title,
      });

      // Asynchronously trigger thumbnail generation
      generateThumbnail(result.artifactId).catch((err) => console.error("Error triggering thumbnail generation:", err));

      res.status(201).json({
        id: result.artifactId,
        artifactId: result.artifactId,
        suggestedCaption: result.suggestedCaption,
        viewConfig: result.viewConfig,
      });
    } catch (err: any) {
      console.error("[SocialRouter] POST /artifact-views/from-hpc-job error:", err);
      res.status(500).json({ error: err.message || "Failed to create artifact view from HPC job" });
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
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    try {
      const notifications = database.getNotifications(userId, limit, category);
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
    const category = typeof req.body?.category === "string" ? req.body.category : undefined;
    try {
      database.markNotificationsRead(userId, category);
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
    const offset = Number(req.query.offset) || 0;
    const artifactType = (req.query.artifactType as string) || undefined;

    try {
      const posts = database.getTopicPosts(concept, currentUserId, limit, offset, artifactType);
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
          const ytRes = await fetch(`https://www.youtube.com/${encodeURIComponent(handle)}`);
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
        let safeSiteUrl: URL | null = null;
        if (!avatarUrl && siteUrl) {
          try {
            safeSiteUrl = assertSafePublicUrl(siteUrl);
          } catch {
            safeSiteUrl = null;
          }
        }
        if (safeSiteUrl) {
          try {
            const htmlRes = await safePublicFetch(safeSiteUrl.href, {
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
