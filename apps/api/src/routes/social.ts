// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "fs";
import { fileURLToPath } from "node:url";
import path from "path";
import Parser from "rss-parser";
import type { LibraryDatabase, PostVisibility } from "../database.js";
import { optionalAuth, requireAuth, requireTokenScope } from "../middleware/auth-middleware.js";
import { ComposerAIService, type ComposerDraftTone, type ComposerPolishMode } from "../services/ai/composer-ai.js";
import { pregenerateServerSvgThumbnail } from "../services/artifact-preprocessor.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { locationService } from "../services/location.js";
import { extractTopics } from "../util/extract-topics.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";
import { isCorporateOrAirgapTier, isFederationDisabled } from "../util/tier-presets.js";
import { generateThumbnail } from "../workers/thumbnailWorker.js";
import { verifySignedEmbedToken } from "./oembed.js";

const ARTIFACT_DIRECTIVE_RE = /::artifact(?:\[([^[\]\r\n]*)\])?\{([^{}\r\n]*)\}/g;

type NormalizedNotebookCell =
  | { id: string; type: "markdown"; content: string }
  | { id: string; type: "artifact"; artifactId: number; title?: string | undefined; caption?: string | undefined };

interface RawNotebookCell {
  id?: string | undefined;
  type?: string | undefined;
  content?: unknown;
  artifactId?: unknown;
  title?: unknown;
  caption?: unknown;
}

interface RawNotebookInput {
  isNotebook?: boolean | undefined;
  title?: unknown;
  summary?: unknown;
  difficulty?: unknown;
  series?: unknown;
  seriesPart?: unknown;
  dialect?: unknown;
  companionRepo?: unknown;
  estimatedReadMinutes?: unknown;
  cells?: RawNotebookCell[] | undefined;
}

function parseNotebookPayload(
  rawContent: string | null | undefined,
  rawNotebook: RawNotebookInput | null | undefined,
  fallbackArtifactId?: number,
): {
  effectiveContent: string | null | undefined;
  notebookMeta: {
    isNotebook: boolean;
    title?: string | undefined;
    summary?: string | undefined;
    difficulty?: string | undefined;
    series?: string | undefined;
    seriesPart?: number | undefined;
    dialect?: string | undefined;
    companionRepo?: string | undefined;
    estimatedReadMinutes?: number | undefined;
    cells: NormalizedNotebookCell[];
    artifactIds: number[];
  } | null;
} {
  const inputCells = Array.isArray(rawNotebook?.cells) ? rawNotebook.cells : null;
  const notebookTitle =
    typeof rawNotebook?.title === "string" && rawNotebook.title.trim() ? rawNotebook.title.trim() : undefined;
  const extraTutorialFields = {
    ...(typeof rawNotebook?.summary === "string" && rawNotebook.summary.trim()
      ? { summary: rawNotebook.summary.trim() }
      : {}),
    ...(typeof rawNotebook?.difficulty === "string" && rawNotebook.difficulty.trim()
      ? { difficulty: rawNotebook.difficulty.trim() }
      : {}),
    ...(typeof rawNotebook?.series === "string" && rawNotebook.series.trim()
      ? { series: rawNotebook.series.trim() }
      : {}),
    ...(Number.isFinite(Number(rawNotebook?.seriesPart)) && Number(rawNotebook?.seriesPart) > 0
      ? { seriesPart: Number(rawNotebook?.seriesPart) }
      : {}),
    ...(typeof rawNotebook?.dialect === "string" && rawNotebook.dialect.trim()
      ? { dialect: rawNotebook.dialect.trim() }
      : {}),
    ...(typeof rawNotebook?.companionRepo === "string" && rawNotebook.companionRepo.trim()
      ? { companionRepo: rawNotebook.companionRepo.trim() }
      : {}),
    ...(Number.isFinite(Number(rawNotebook?.estimatedReadMinutes)) && Number(rawNotebook?.estimatedReadMinutes) > 0
      ? { estimatedReadMinutes: Number(rawNotebook?.estimatedReadMinutes) }
      : {}),
  };

  if (inputCells && inputCells.length > 0) {
    const normalizedCells: NormalizedNotebookCell[] = [];
    const artifactIds: number[] = [];

    inputCells.forEach((cell: RawNotebookCell, idx: number) => {
      if (cell?.type === "markdown") {
        normalizedCells.push({
          id: cell.id || `md-${idx}`,
          type: "markdown",
          content: typeof cell.content === "string" ? cell.content : "",
        });
      } else if (cell?.type === "artifact" && Number.isFinite(Number(cell.artifactId))) {
        const aid = Number(cell.artifactId);
        normalizedCells.push({
          id: cell.id || `art-${idx}`,
          type: "artifact",
          artifactId: aid,
          ...(cell.title ? { title: String(cell.title) } : {}),
          ...(cell.caption ? { caption: String(cell.caption) } : {}),
        });
        if (!artifactIds.includes(aid)) {
          artifactIds.push(aid);
        }
      }
    });

    let effectiveContent = rawContent;
    if (!effectiveContent || !effectiveContent.trim()) {
      const blocks: string[] = [];
      if (notebookTitle) {
        blocks.push(`# ${notebookTitle}`);
      }
      for (const c of normalizedCells) {
        if (c.type === "markdown" && c.content.trim()) {
          blocks.push(c.content.trim());
        } else if (c.type === "artifact") {
          const label = c.title ? `[${c.title.replace(/\]/g, "")}]` : "";
          const captionAttr = c.caption ? ` caption="${c.caption.replace(/"/g, "'")}"` : "";
          blocks.push(`::artifact${label}{id=${c.artifactId}${captionAttr}}`);
        }
      }
      effectiveContent = blocks.join("\n\n");
    }

    return {
      effectiveContent,
      notebookMeta: {
        isNotebook: Boolean(
          rawNotebook?.isNotebook ?? (normalizedCells.length > 1 || artifactIds.length > 1 || notebookTitle),
        ),
        ...(notebookTitle ? { title: notebookTitle } : {}),
        ...extraTutorialFields,
        cells: normalizedCells,
        artifactIds,
      },
    };
  }

  if (typeof rawContent === "string" && rawContent.includes("::artifact")) {
    ARTIFACT_DIRECTIVE_RE.lastIndex = 0;
    const cells: NormalizedNotebookCell[] = [];
    const artifactIds: number[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = ARTIFACT_DIRECTIVE_RE.exec(rawContent)) !== null) {
      const before = rawContent.slice(lastIndex, match.index).trim();
      if (before) {
        cells.push({ id: `md-${idx++}`, type: "markdown", content: before });
      }
      const bracketTitle = match[1]?.trim();
      const attrStr = match[2] || "";
      const idMatch = attrStr.match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
      const captionMatch = attrStr.match(/(?:^|\s)caption\s*=\s*(?:"([^"]*)"|'([^']*)')/);
      if (idMatch && idMatch[1]) {
        const aid = Number(idMatch[1]);
        const caption = captionMatch ? (captionMatch[1] ?? captionMatch[2]) : undefined;
        cells.push({
          id: `art-${idx++}`,
          type: "artifact",
          artifactId: aid,
          ...(bracketTitle ? { title: bracketTitle } : {}),
          ...(caption ? { caption } : {}),
        });
        if (!artifactIds.includes(aid)) {
          artifactIds.push(aid);
        }
      }
      lastIndex = match.index + match[0].length;
    }

    const tail = rawContent.slice(lastIndex).trim();
    if (tail) {
      cells.push({ id: `md-${idx++}`, type: "markdown", content: tail });
    }

    if (artifactIds.length > 0) {
      return {
        effectiveContent: rawContent,
        notebookMeta: {
          isNotebook: true,
          ...(notebookTitle ? { title: notebookTitle } : {}),
          ...extraTutorialFields,
          cells,
          artifactIds,
        },
      };
    }
  }

  if (fallbackArtifactId && rawNotebook?.isNotebook) {
    return {
      effectiveContent: rawContent,
      notebookMeta: {
        isNotebook: true,
        ...(notebookTitle ? { title: notebookTitle } : {}),
        ...extraTutorialFields,
        cells: [
          ...(rawContent ? [{ id: "md-0", type: "markdown" as const, content: rawContent }] : []),
          { id: "art-0", type: "artifact" as const, artifactId: Number(fallbackArtifactId) },
        ],
        artifactIds: [Number(fallbackArtifactId)],
      },
    };
  }

  return { effectiveContent: rawContent, notebookMeta: null };
}

export function socialRouter(database: LibraryDatabase, worker?: FederationWorker): Router {
  const router = createRouter();

  /**
   * POST /api/v1/social/posts
   */
  router.post("/posts", requireAuth, requireTokenScope("social:write"), (req: Request, res: Response) => {
    const authorId = req.user!.id;
    const {
      content: rawContent,
      artifact_view_id: raw_artifact_view_id,
      artifactId,
      reply_to_id,
      quote_post_id,
      repost_of_id,
      client_signature,
      key_id_string,
      metadata: rawMetadata,
      reply_visibility,
      visibility,
      poll: rawPoll,
      content_warning,
      notebook: topLevelNotebook,
      cells: topLevelCells,
    } = req.body;

    const explicitArtifactId = raw_artifact_view_id ?? artifactId;
    const rawNotebookInput =
      (topLevelNotebook as RawNotebookInput | undefined) ||
      (Array.isArray(topLevelCells) ? { isNotebook: true, cells: topLevelCells as RawNotebookCell[] } : null) ||
      (typeof rawMetadata === "object" && rawMetadata !== null
        ? ((rawMetadata as Record<string, unknown>)["notebook"] as RawNotebookInput | undefined)
        : null);

    const { effectiveContent: content, notebookMeta } = parseNotebookPayload(
      rawContent,
      rawNotebookInput,
      explicitArtifactId,
    );

    const artifact_view_id = explicitArtifactId ?? notebookMeta?.artifactIds?.[0];
    const metadata: Record<string, unknown> = {
      ...(typeof rawMetadata === "object" && rawMetadata !== null ? (rawMetadata as Record<string, unknown>) : {}),
      ...(notebookMeta ? { notebook: notebookMeta } : {}),
      ...(content_warning ? { contentWarning: content_warning } : {}),
      ...(client_signature ? { clientSignature: client_signature, client_signature } : {}),
      ...(key_id_string ? { keyIdString: key_id_string, key_id_string } : {}),
    };

    const pollInput =
      rawPoll && typeof rawPoll === "object"
        ? (rawPoll as {
            options?: unknown;
            expiresInSeconds?: number;
            expires_in?: number;
            multiple?: boolean;
          })
        : null;
    const pollOptions = Array.isArray(pollInput?.options)
      ? pollInput.options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    if (!content && !repost_of_id && !artifact_view_id && !notebookMeta?.cells?.length && pollOptions.length < 2) {
      res.status(400).json({ error: "Content, artifact, poll, or repost target is required" });
      return;
    }

    try {
      if (artifact_view_id !== undefined && artifact_view_id !== null) {
        const artifactRow = database.getArtifactView(Number(artifact_view_id));
        if (artifactRow) {
          const artifactOwnerId = artifactRow.creator_id ?? artifactRow.author_id;
          let isPrivateArtifact = false;
          try {
            const cfg =
              typeof artifactRow.view_config === "string"
                ? (JSON.parse(artifactRow.view_config) as Record<string, unknown>)
                : (artifactRow.view_config as Record<string, unknown> | undefined);
            if (cfg && (cfg["private"] === true || cfg["visibility"] === "private")) {
              isPrivateArtifact = true;
            }
          } catch {}
          if (
            artifactOwnerId &&
            artifactOwnerId !== authorId &&
            req.user?.role !== "admin" &&
            (isPrivateArtifact || process.env["NODE_ENV"] === "production")
          ) {
            res.status(403).json({ error: "Forbidden: Cannot attach another user's artifact view" });
            return;
          }
        }
      }

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
        content ?? null,
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
        undefined,
        undefined,
        undefined,
        typeof visibility === "string" ? visibility : undefined,
      );
      if (pollOptions.length >= 2) {
        const expiresSec = Number(pollInput?.expiresInSeconds ?? pollInput?.expires_in ?? 86400);
        const expiresAt =
          Number.isFinite(expiresSec) && expiresSec > 0 ? new Date(Date.now() + expiresSec * 1000).toISOString() : null;
        database.createPostPoll(id, pollOptions, expiresAt, Boolean(pollInput?.multiple));
      }
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

              if (fullAuthor && fullAuthor.actor_url && (content || post?.poll)) {
                // Find remote followers
                const remoteFollowers = database.getRemoteFollowersInboxes(authorId);
                const mentionTags: { type: "Mention"; href: string; name: string }[] = [];
                const additionalInboxes: {
                  inbox_url: string;
                  shared_inbox_url?: string | undefined;
                  remote_domain: string;
                }[] = [];

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
                          const endpoints = resolved.actor?.["endpoints"] as
                            | { sharedInbox?: string | undefined }
                            | undefined;
                          const inbox =
                            endpoints?.sharedInbox ||
                            (resolved.actor?.["sharedInbox"] as string) ||
                            (resolved.actor?.["inbox"] as string) ||
                            `${resolved.actorUrl}/inbox`;
                          const domain = new URL(resolved.actorUrl).hostname;
                          additionalInboxes.push({
                            inbox_url: inbox,
                            shared_inbox_url:
                              endpoints?.sharedInbox || (resolved.actor?.["sharedInbox"] as string) || undefined,
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
                      // If the mentioned account is an automated bot, enqueue for background LLM processing
                      if (mentionedUser.account_type === "bot") {
                        database.enqueueBotMention(mentionedUser.id, id, authorId);
                      }
                    }
                  }
                }

                const { buildAddressingForVisibility, serializeArtifactAttachment } = await import("./federation.js");
                const addressing = buildAddressingForVisibility(
                  (post?.visibility as PostVisibility) || "public",
                  fullAuthor.actor_url,
                  mentionTags.map((m) => m.href),
                );
                const activeRelays = database.listFederationRelays().filter((r) => r.state === "accepted");

                if (
                  remoteFollowers.length > 0 ||
                  additionalInboxes.length > 0 ||
                  (activeRelays.length > 0 && (post?.visibility || "public") === "public")
                ) {
                  const apPostId = `${fullAuthor.actor_url}/posts/${id}`;

                  const noteObject: Record<string, unknown> = {
                    id: apPostId,
                    type: post?.poll ? "Question" : "Note",
                    published: new Date().toISOString(),
                    attributedTo: fullAuthor.actor_url,
                    content: content || "",
                    to: addressing.to,
                    cc: addressing.cc,
                  };

                  if (post?.poll) {
                    const optionItems = post.poll.options.map((opt) => ({
                      type: "Note",
                      name: opt.title,
                      replies: {
                        type: "Collection",
                        totalItems: opt.votes_count,
                      },
                    }));
                    noteObject[post.poll.multiple ? "anyOf" : "oneOf"] = optionItems;
                    if (post.poll.expires_at) {
                      noteObject["endTime"] = post.poll.expires_at;
                    }
                  }

                  const metaCw =
                    typeof metadata["contentWarning"] === "string" ? metadata["contentWarning"] : undefined;
                  if (content_warning || metaCw) {
                    noteObject["summary"] = content_warning || metaCw;
                  }

                  if (mentionTags.length > 0) {
                    noteObject["tag"] = mentionTags;
                  }

                  if (client_signature && key_id_string) {
                    noteObject["proof"] = {
                      type: "RsaSignature2017",
                      creator: `${fullAuthor.actor_url}#${key_id_string}`,
                      created: new Date().toISOString(),
                      signatureValue: client_signature,
                    };
                  }

                  const allArtifactIds = Array.from(
                    new Set(
                      [artifact_view_id, ...(notebookMeta?.artifactIds || [])].filter(
                        (aid): aid is number => typeof aid === "number" && Number.isFinite(aid),
                      ),
                    ),
                  );
                  if (allArtifactIds.length > 0) {
                    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
                    const attachments = allArtifactIds
                      .map((aid) => {
                        const artifact = database.getArtifactView(aid);
                        return serializeArtifactAttachment(artifact, publicUrl);
                      })
                      .filter(Boolean);
                    if (attachments.length > 0) {
                      noteObject["attachment"] = attachments;
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
                    to: addressing.to,
                    cc: addressing.cc,
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
                    } catch {
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
   * PUT /api/v1/social/posts/:id
   * Updates an existing post or long-form notebook tutorial.
   */
  const handleUpdatePost = (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    const userId = req.user!.id;

    try {
      const existingPost = database.getPost(postId, userId);
      if (!existingPost) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      if (existingPost.author_id !== userId && req.user!.role !== "admin") {
        res.status(403).json({ error: "You can only edit your own posts" });
        return;
      }

      const {
        content: rawContent,
        artifact_view_id: raw_artifact_view_id,
        artifactId,
        client_signature,
        key_id_string,
        metadata: rawMetadata,
        reply_visibility,
        content_warning,
        notebook: topLevelNotebook,
        cells: topLevelCells,
      } = req.body;

      const explicitArtifactId = raw_artifact_view_id ?? artifactId;
      const rawNotebookInput =
        (topLevelNotebook as RawNotebookInput | undefined) ||
        (Array.isArray(topLevelCells) ? { isNotebook: true, cells: topLevelCells as RawNotebookCell[] } : null) ||
        (typeof rawMetadata === "object" && rawMetadata !== null
          ? ((rawMetadata as Record<string, unknown>)["notebook"] as RawNotebookInput | undefined)
          : null);

      const { effectiveContent: content, notebookMeta } = parseNotebookPayload(
        rawContent !== undefined ? rawContent : existingPost.content,
        rawNotebookInput,
        explicitArtifactId !== undefined ? explicitArtifactId : (existingPost.artifact_view_id ?? undefined),
      );

      const artifact_view_id =
        explicitArtifactId !== undefined
          ? explicitArtifactId
          : (notebookMeta?.artifactIds?.[0] ?? existingPost.artifact_view_id);

      const existingMeta =
        typeof existingPost.metadata === "object" && existingPost.metadata !== null ? existingPost.metadata : {};

      const mergedMetadata = {
        ...existingMeta,
        ...(typeof rawMetadata === "object" && rawMetadata !== null ? rawMetadata : {}),
        ...(notebookMeta ? { notebook: notebookMeta } : {}),
        ...(content_warning !== undefined ? { contentWarning: content_warning } : {}),
        ...(client_signature ? { clientSignature: client_signature, client_signature } : {}),
        ...(key_id_string ? { keyIdString: key_id_string, key_id_string } : {}),
      };

      database.updatePost(postId, {
        content: content ?? existingPost.content,
        artifactViewId: artifact_view_id,
        metadata: mergedMetadata,
        replyVisibility: reply_visibility ?? existingPost.reply_visibility,
      });

      const updatedPost = database.getPost(postId, userId);
      res.json({ post: updatedPost });
    } catch (err: unknown) {
      console.error("PUT /posts/:id error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update post" });
    }
  };

  router.put("/posts/:id", requireAuth, handleUpdatePost);
  router.patch("/posts/:id", requireAuth, handleUpdatePost);

  /**
   * DELETE /api/v1/social/posts/:id
   */
  router.delete("/posts/:id", requireAuth, async (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
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
    } catch (err: unknown) {
      console.error("DELETE /posts/:id error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete post" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/card
   *
   * Renders dynamic OpenGraph and Twitter Card preview HTML with oEmbed discovery links.
   */
  router.get("/posts/:id/card", optionalAuth, (req: Request, res: Response): void => {
    const settings = database.getInstanceSettings();
    const isCorporateGated =
      (settings.federationMode === "disabled" && settings.registrationMode !== "open") ||
      (process.env["NODE_ENV"] === "production" && isCorporateOrAirgapTier(settings));
    if (isCorporateGated && !req.user) {
      res.status(401).json({ error: "Authentication required to view post cards on corporate air-gapped instances." });
      return;
    }

    const postId = Number(req.params["id"]);
    const post = database.getPost(postId);
    if (!post) {
      res.status(404).send("Post not found");
      return;
    }

    const brandName = settings.instanceName || "Ansatz";
    const host = `${req.protocol}://${req.get("host") || "ansatz.social"}`;
    const postUrl = `${host}/p/${postId}`;
    const oembedUrl = `${host}/api/v1/oembed?url=${encodeURIComponent(postUrl)}&format=json`;
    const title = post.title || post.content?.slice(0, 60) || `${brandName} Engineering Simulation`;
    const description =
      post.content?.slice(0, 200) ||
      `Interactive physical modeling and simulation on ${brandName} (powered by ModelScript)`;
    const author = post.display_name || post.username || `${brandName} Engineer`;
    const thumb = post.thumbnail_url || `${host}/api/v1/artifacts/default-thumb.webp`;

    const escapeHtml = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(thumb)}">
  <meta property="og:url" content="${escapeHtml(postUrl)}">
  <meta property="og:site_name" content="${escapeHtml(brandName)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(thumb)}">
  <meta name="twitter:creator" content="@${escapeHtml(author)}">
  <link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembedUrl)}" title="${escapeHtml(title)}">
</head>
<body style="font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem;">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
  <a href="${escapeHtml(postUrl)}" style="color: #58a6ff;">View interactive model on ${escapeHtml(brandName)}</a>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", isCorporateOrAirgapTier(settings) ? "private, no-store" : "public, max-age=3600");
    res.send(html);
  });

  /**
   * GET /api/v1/social/posts/:id
   */
  router.get("/posts/:id", optionalAuth, (req: Request, res: Response): void => {
    const postId = Number(req.params["id"]);
    const userAgent = req.headers["user-agent"] || "";
    const isBot = /bot|spider|crawl|facebookexternalhit|whatsapp|slackbot|discordbot|twitterbot/i.test(userAgent);

    if (isBot || req.query["format"] === "html") {
      res.redirect(302, `/api/v1/social/posts/${postId}/card`);
      return;
    }

    const currentUserId = req.user?.id;
    try {
      const post = database.getPost(postId, currentUserId);
      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      if (post.visibility === "followers") {
        const isAllowed =
          currentUserId === post.author_id ||
          req.user?.role === "admin" ||
          Boolean(currentUserId && database.isFollowing(currentUserId, post.author_id));
        if (!isAllowed) {
          res.status(403).json({ error: "This post is only visible to followers" });
          return;
        }
      } else if (post.visibility === "direct") {
        const isMentioned = Boolean(
          req.user?.username && new RegExp(`@${req.user.username}\\b`, "i").test(post.content || ""),
        );
        const isAllowed = currentUserId === post.author_id || req.user?.role === "admin" || isMentioned;
        if (!isAllowed) {
          res.status(403).json({ error: "This direct post is only visible to mentioned recipients" });
          return;
        }
      }

      const filtered = database.applyContentFiltersToPosts([post], "thread", currentUserId);
      res.json({ post: filtered[0] ?? post });
    } catch {
      res.status(500).json({ error: "Failed to fetch post" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/view
   */
  router.post("/posts/:id/view", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    if (!Number.isFinite(postId) || postId <= 0) {
      res.status(400).json({ error: "Invalid post ID" });
      return;
    }
    try {
      const ua = req.headers["user-agent"] as string | undefined;
      if (locationService.isBotUserAgent(ua)) {
        res.json({ success: true, counted: false, ignored: "bot" });
        return;
      }

      if (!locationService.checkAndMarkUniqueHit(req, `post:${postId}`)) {
        res.json({ success: true, counted: false, deduplicated: true });
        return;
      }

      let profileLocation: string | undefined;
      if (req.user) {
        const user = database.getUserById(req.user.id);
        if (user) {
          const profile = database.getFullProfileByUsername(user.username);
          if (profile?.location) {
            profileLocation = profile.location;
          }
        }
      }

      const { countryCode, regionCode } = locationService.resolveRequestGeo(req, profileLocation);

      database.incrementPostView(postId, countryCode, regionCode);
      res.json({ success: true, counted: true });
    } catch {
      res.status(500).json({ error: "Failed to increment view" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/analytics
   */
  router.get("/posts/:id/analytics", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
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
    } catch {
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });
  /**
   * GET /api/v1/social/posts/:id/replies
   */
  router.get("/posts/:id/replies", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    const currentUserId = req.user?.id;
    const limit = Number(req.query["limit"]) || 50;
    try {
      const posts = database.getReplies(postId, currentUserId, limit);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to fetch replies" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/parents
   */
  router.get("/posts/:id/parents", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    const currentUserId = req.user?.id;
    try {
      const posts = database.getPostParents(postId, currentUserId);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to fetch parents" });
    }
  });

  /**
   * GET /api/v1/social/timeline
   */
  router.get("/timeline", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query["limit"]) || 20;
    const offset = Number(req.query["offset"]) || 0;
    const artifactType = (req.query["artifactType"] as string) || undefined;
    const tag = (req.query["tag"] as string) || undefined;
    try {
      const posts = database.getHomeTimeline(userId, limit, offset, artifactType, tag);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to get timeline" });
    }
  });

  /**
   * GET /api/v1/social/timeline/following
   */
  router.get("/timeline/following", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query["limit"]) || 20;
    const sort = req.query["sort"] as string;
    const offset = Number(req.query["offset"]) || 0;
    const artifactType = (req.query["artifactType"] as string) || undefined;
    const tag = (req.query["tag"] as string) || undefined;
    try {
      const posts = database.getFollowingTimeline(userId, limit, sort, offset, artifactType, tag);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to get following timeline" });
    }
  });

  /**
   * GET /api/v1/social/timeline/federated
   */
  router.get("/timeline/federated", optionalAuth, (req: Request, res: Response) => {
    const currentUserId = req.user?.id;
    if (!database.getInstanceSettings().federatedTimelinePublic && !currentUserId) {
      res.status(401).json({ error: "Authentication required to view federated timeline on this instance" });
      return;
    }
    const limit = Number(req.query["limit"]) || 20;
    const offset = Number(req.query["offset"]) || 0;
    const artifactType = (req.query["artifactType"] as string) || undefined;
    const tag = (req.query["tag"] as string) || undefined;
    try {
      const posts = database.getFederatedTimeline(currentUserId, limit, offset, artifactType, tag);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to get federated timeline" });
    }
  });

  /**
   * GET /api/v1/social/explore
   */
  router.get("/explore", optionalAuth, (req: Request, res: Response) => {
    const currentUserId = req.user?.id;
    const limit = Number(req.query["limit"]) || 20;
    const offset = Number(req.query["offset"]) || 0;
    const artifactType = (req.query["artifactType"] as string) || undefined;
    const tag = (req.query["tag"] as string) || undefined;
    try {
      const posts = database.getExploreTimeline(currentUserId, limit, offset, artifactType, tag);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to get explore timeline" });
    }
  });

  /**
   * GET /api/v1/social/users/:username/posts
   */
  router.get("/users/:username/posts", optionalAuth, (req: Request, res: Response) => {
    const username = req.params["username"] as string;
    const currentUserId = req.user?.id;
    const limit = Number(req.query["limit"]) || 20;
    const type = req.query["type"] as string | undefined;

    try {
      const posts = database.getUserTimeline(username, currentUserId, limit, type);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to get user timeline" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/like
   */
  router.post("/posts/:id/like", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params["id"]);
    try {
      const liked = database.toggleLike(userId, postId);
      res.json({ liked });
    } catch {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/bookmark
   */
  router.post("/posts/:id/bookmark", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params["id"]);
    try {
      const bookmarked = database.toggleBookmark(userId, postId);
      res.json({ bookmarked });
    } catch {
      res.status(500).json({ error: "Failed to toggle bookmark" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/repost
   */
  router.post("/posts/:id/repost", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params["id"]);
    try {
      const reposted = database.toggleRepost(userId, postId);
      res.json({ reposted });
    } catch {
      res.status(500).json({ error: "Failed to toggle repost" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/report
   * Allows users to report abusive posts, illegal content, or copyright violations
   */
  router.post("/posts/:id/report", requireAuth, (req: Request, res: Response) => {
    const reporterId = req.user!.id;
    const postId = Number(req.params["id"]);
    const { reason, details, forwardFederatedFlag, ruleIds, rule_ids, category } = req.body;

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

      const rawRuleIds = Array.isArray(ruleIds) ? ruleIds : Array.isArray(rule_ids) ? rule_ids : undefined;

      const report = database.createContentReport(reporterId, {
        postId,
        targetUserId: post.author_id,
        targetType: "post",
        targetResourceId: String(postId),
        reason,
        details,
        ruleIds: rawRuleIds ? rawRuleIds.map(Number).filter(Number.isFinite) : undefined,
        category: typeof category === "string" ? category : undefined,
      });

      let federatedFlagQueued = false;
      if (forwardFederatedFlag && !isFederationDisabled(database.getInstanceSettings())) {
        const fedInfo = database.getUserFederationInfo(post.author_id);
        const remoteDomain =
          fedInfo?.remote_domain ||
          (post.username && post.username.includes("@") ? post.username.split("@").pop() : undefined);
        if (remoteDomain) {
          const baseUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
          const flagId = `${baseUrl}/flags/${report.id}-${Date.now()}`;
          const targetInbox = fedInfo?.inbox_url || `https://${remoteDomain}/inbox`;
          const targetObjects: string[] = [];
          if (fedInfo?.actor_url) targetObjects.push(fedInfo.actor_url);
          if (post.ap_id) targetObjects.push(post.ap_id);
          const flagActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: flagId,
            type: "Flag",
            actor: `${baseUrl}/actor`,
            object: targetObjects.length === 1 ? targetObjects[0] : targetObjects,
            content: `${reason}${details ? `: ${details}` : ""}`,
          };
          database.enqueueFederationDelivery("Flag", flagId, flagActivity, targetInbox, remoteDomain);
          federatedFlagQueued = true;
        }
      }

      database.logAudit({
        actorId: reporterId,
        action: "post_reported",
        resourceType: "post",
        resourceId: String(postId),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { reason, details, reportId: report.id, federatedFlagQueued },
      });

      res.status(201).json({
        success: true,
        reportId: report.id,
        status: report.status,
        federatedFlagQueued,
        message: "Report submitted successfully. Content will be reviewed by moderation.",
      });
    } catch (err: unknown) {
      console.error("POST /posts/:id/report error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to submit report" });
    }
  });

  /**
   * POST /api/v1/social/reports
   * Universal abuse/violation report intake for packages, repositories, posts, or users
   */
  router.post("/reports", requireAuth, (req: Request, res: Response) => {
    const reporterId = req.user!.id;
    const { targetType, targetResourceId, postId, targetUserId, reason, details, ruleIds, rule_ids, category } =
      req.body || {};

    if (!reason || typeof reason !== "string") {
      res.status(400).json({ error: "Report reason is required" });
      return;
    }

    const allowedTargetTypes = new Set(["post", "user", "package", "repo"]);
    const resolvedTargetType =
      typeof targetType === "string" && allowedTargetTypes.has(targetType) ? targetType : "package";

    try {
      const rawRuleIds = Array.isArray(ruleIds) ? ruleIds : Array.isArray(rule_ids) ? rule_ids : undefined;

      const report = database.createContentReport(reporterId, {
        postId: typeof postId === "number" ? postId : undefined,
        targetUserId: typeof targetUserId === "number" ? targetUserId : undefined,
        targetType: resolvedTargetType,
        targetResourceId: targetResourceId != null ? String(targetResourceId) : undefined,
        reason,
        details: typeof details === "string" ? details : undefined,
        ruleIds: rawRuleIds ? rawRuleIds.map(Number).filter(Number.isFinite) : undefined,
        category: typeof category === "string" ? category : undefined,
      });

      database.logAudit({
        actorId: reporterId,
        action: `${resolvedTargetType}_reported`,
        resourceType: resolvedTargetType,
        resourceId: targetResourceId != null ? String(targetResourceId) : String(postId ?? targetUserId ?? report.id),
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip,
        details: { reason, details, targetType: resolvedTargetType, targetResourceId, reportId: report.id },
      });

      res.status(201).json({
        success: true,
        reportId: report.id,
        status: report.status,
        targetType: resolvedTargetType,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to submit resource report" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/quotes
   */
  router.get("/posts/:id/quotes", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    const userId = req.user?.id;
    try {
      const quotes = database.getQuotes(postId, userId);
      res.json({ quotes, posts: quotes });
    } catch (err: unknown) {
      console.error("GET /posts/:id/quotes error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch quotes" });
    }
  });

  /**
   * GET /api/v1/social/posts/:id/reposts
   */
  router.get("/posts/:id/reposts", optionalAuth, (req: Request, res: Response) => {
    const postId = Number(req.params["id"]);
    const userId = req.user?.id;
    try {
      const reposts = database.getReposts(postId, userId);
      res.json({ reposts, posts: reposts });
    } catch (err: unknown) {
      console.error("GET /posts/:id/reposts error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch reposts" });
    }
  });

  /**
   * GET /api/v1/social/artifact-views/:id
   */
  router.get("/artifact-views/:id", optionalAuth, (req: Request, res: Response) => {
    const id = Number(req.params["id"]);
    try {
      const embedToken =
        (typeof req.query["embed_token"] === "string" ? req.query["embed_token"] : undefined) ||
        (typeof req.headers["x-embed-token"] === "string" ? req.headers["x-embed-token"] : undefined);

      if (embedToken) {
        const verification = verifySignedEmbedToken(embedToken, String(id), req.headers.origin);
        if (!verification.valid) {
          res.status(403).json({ error: verification.reason || "Invalid embed token" });
          return;
        }
      }

      const artifactView = database.getArtifactView(id);
      if (!artifactView) {
        res.status(404).json({ error: "Artifact view not found" });
        return;
      }

      // Enforce private artifact visibility unless owner, admin, or valid embed_token
      let isPrivate = false;
      try {
        const cfg =
          typeof artifactView.view_config === "string"
            ? (JSON.parse(artifactView.view_config) as Record<string, unknown>)
            : (artifactView.view_config as Record<string, unknown> | undefined);
        if (cfg && (cfg["private"] === true || cfg["visibility"] === "private")) {
          isPrivate = true;
        }
      } catch {}

      const ownerId = artifactView.creator_id ?? artifactView.author_id;
      const isOwnerOrAdmin = Boolean(req.user && (req.user.id === ownerId || req.user.role === "admin"));
      if (isPrivate && !isOwnerOrAdmin && !embedToken) {
        res.status(403).json({ error: "Forbidden: Private artifact requires authentication or a signed embed token" });
        return;
      }

      res.json({ artifactView });
    } catch {
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
      if (!req.user && process.env["NODE_ENV"] === "production") {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const artifact = database.getArtifactView(id);
      if (!artifact) {
        res.status(404).json({ error: "Artifact view not found" });
        return;
      }

      const ownerId = artifact.creator_id ?? artifact.author_id;
      if (req.user && ownerId && ownerId !== req.user.id && req.user.role !== "admin") {
        res.status(403).json({ error: "Forbidden: Not the owner of this artifact view" });
        return;
      }

      // Extract base64 and restrict extension to safe raster formats
      const matches = rawData.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      const rawExt = matches ? (matches[1] === "jpeg" ? "jpg" : matches[1]!.toLowerCase()) : "webp";
      const allowedExts = new Set(["png", "jpg", "webp", "gif"]);
      const ext = allowedExts.has(rawExt) ? rawExt : "webp";
      const base64Data = matches ? matches[2]! : rawData.replace(/^data:.*?;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/thumbnails");
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const filename = `artifact_${id}_thumb_${Date.now()}.${ext}`;
      const filePath = path.join(outDir, filename);
      fs.writeFileSync(filePath, buffer);

      const thumbnailUrl = `/thumbnails/${filename}`;
      database.updateArtifactThumbnail(id, thumbnailUrl);

      res.json({ success: true, thumbnailUrl });
    } catch (err: unknown) {
      console.error("[socialRouter] Error saving artifact thumbnail:", err);
      res.status(500).json({ error: "Failed to save thumbnail" });
    }
  });

  async function enrichInlineArtifactConfig(
    artifactType: string,
    rawViewConfig: unknown,
    title?: string,
  ): Promise<{ viewConfigStr: string; thumbnailUrl?: string | undefined }> {
    let parsed: Record<string, unknown> = {};
    if (typeof rawViewConfig === "string") {
      try {
        parsed = JSON.parse(rawViewConfig) as Record<string, unknown>;
      } catch {
        return { viewConfigStr: rawViewConfig };
      }
    } else if (rawViewConfig && typeof rawViewConfig === "object") {
      parsed = { ...(rawViewConfig as Record<string, unknown>) };
    }

    const inlineCode =
      typeof parsed["code"] === "string"
        ? parsed["code"]
        : typeof parsed["modelicaCode"] === "string"
          ? parsed["modelicaCode"]
          : typeof parsed["source"] === "string"
            ? parsed["source"]
            : "";

    let thumbnailUrl: string | undefined =
      typeof parsed["thumbnailUrl"] === "string" ? parsed["thumbnailUrl"] : undefined;

    if (inlineCode.trim().length > 0 && !parsed["svg"] && artifactType) {
      const uploadDir = path.resolve(process.cwd(), "data", "uploads");
      try {
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const tempName = `inline-${Date.now()}-${Math.round(Math.random() * 1e9)}.txt`;
        const tempPath = path.join(uploadDir, tempName);
        fs.writeFileSync(tempPath, inlineCode, "utf-8");
        try {
          const parsedTitle = typeof parsed["title"] === "string" ? parsed["title"] : undefined;
          const rawDialect = typeof parsed["dialect"] === "string" ? parsed["dialect"].toLowerCase().trim() : "";
          const effectiveType =
            artifactType === "morsel" || artifactType === "polyglot-morsel"
              ? !rawDialect || rawDialect === "modelica"
                ? "modelica-diagram"
                : rawDialect
              : artifactType;
          const preprocessed = await pregenerateServerSvgThumbnail(
            tempPath,
            effectiveType,
            title || parsedTitle || "model",
            uploadDir,
          );
          if (preprocessed.viewConfigAdditions) {
            parsed = { ...preprocessed.viewConfigAdditions, ...parsed };
          }
          if (preprocessed.svg) {
            parsed["svg"] = preprocessed.svg;
          }
          if (preprocessed.metadata) {
            const existingMeta =
              typeof parsed["metadata"] === "object" && parsed["metadata"] !== null
                ? (parsed["metadata"] as Record<string, unknown>)
                : {};
            parsed["metadata"] = { ...existingMeta, ...preprocessed.metadata };
          }
          if (preprocessed.thumbnailUrl) {
            thumbnailUrl = preprocessed.thumbnailUrl;
            parsed["thumbnailUrl"] = preprocessed.thumbnailUrl;
            parsed["thumbnail_url"] = preprocessed.thumbnailUrl;
          }
        } finally {
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch {
            // ignore cleanup error
          }
        }
      } catch (err) {
        console.warn("[socialRouter] Inline SVG pre-generation skipped:", err);
      }
    }

    return {
      viewConfigStr: JSON.stringify(parsed),
      thumbnailUrl,
    };
  }

  /**
   * POST /api/v1/social/artifact-views
   */
  router.post("/artifact-views", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { artifact_type, view_config, title } = req.body;
    try {
      const { viewConfigStr, thumbnailUrl } = await enrichInlineArtifactConfig(artifact_type, view_config, title);
      const id = database.createArtifactView(userId, artifact_type, "upload", viewConfigStr, title, thumbnailUrl);

      // Asynchronously trigger thumbnail generation if applicable
      if (["simulation-result", "fea-result", "cfd-result", "cad-step", "cad_step"].includes(artifact_type)) {
        generateThumbnail(id).catch((err) => console.error("Error triggering thumbnail generation:", err));
      }

      res.status(201).json({ id, thumbnail_url: thumbnailUrl || null });
    } catch {
      res.status(500).json({ error: "Failed to create artifact view" });
    }
  });

  /**
   * PUT /api/v1/social/artifact-views/:id
   */
  router.put("/artifact-views/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params["id"];
    const id = Number(Array.isArray(rawId) ? rawId[0] : rawId);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid artifact ID" });
      return;
    }

    try {
      const existing = database.getArtifactView(id);
      if (!existing) {
        res.status(404).json({ error: "Artifact view not found" });
        return;
      }

      const ownerId = existing.creator_id ?? existing.author_id;
      if (req.user && ownerId && ownerId !== req.user.id && req.user.role !== "admin") {
        res.status(403).json({ error: "Forbidden: Not the owner of this artifact view" });
        return;
      }

      const { view_config, viewConfig, artifact_type, title } = req.body;
      const rawConfig = view_config !== undefined ? view_config : viewConfig;
      if (rawConfig === undefined) {
        res.status(400).json({ error: "view_config is required" });
        return;
      }

      const effectiveType = artifact_type || existing.view_type || "modelica-code";
      const effectiveTitle = title || existing.title || "Model";

      const { viewConfigStr, thumbnailUrl } = await enrichInlineArtifactConfig(
        effectiveType,
        rawConfig,
        effectiveTitle,
      );

      database.updateArtifactViewConfig(id, viewConfigStr);
      if (thumbnailUrl) {
        database.updateArtifactThumbnail(id, thumbnailUrl);
      }

      const updated = database.getArtifactView(id);
      res.json({ id, artifactView: updated });
    } catch (err) {
      console.error("[socialRouter] Error updating artifact view:", err);
      res.status(500).json({ error: "Failed to update artifact view" });
    }
  });

  /**
   * POST /api/v1/social/artifact-views/from-hpc-job
   */
  router.post("/artifact-views/from-hpc-job", optionalAuth, (req: Request, res: Response) => {
    if (!req.user && process.env["NODE_ENV"] === "production") {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userId = req.user?.id || 1;
    const { jobId, colormap, activeField, title } = req.body;

    if (!jobId) {
      return res.status(400).json({ error: "Missing required jobId parameter" });
    }

    try {
      const job = database.getJob(Number(jobId));
      if (req.user && job && job.user_id && job.user_id !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden: Job belongs to another user" });
      }

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
    } catch (err: unknown) {
      console.error("[SocialRouter] POST /artifact-views/from-hpc-job error:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to create artifact view from HPC job",
      });
    }
    return;
  });

  /**
   * GET /api/v1/social/bookmarks
   */
  router.get("/bookmarks", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query["limit"]) || 20;
    try {
      const posts = database.getBookmarks(userId, limit);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  /**
   * GET /api/v1/social/notifications
   */
  router.get("/notifications", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Number(req.query["limit"]) || 20;
    const category = typeof req.query["category"] === "string" ? req.query["category"] : undefined;
    try {
      const notifications = database.getNotifications(userId, limit, category);
      const unreadCount = database.getUnreadNotificationCount(userId);
      res.json({ notifications, unreadCount });
    } catch {
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
    } catch {
      res.status(500).json({ error: "Failed to mark notifications read" });
    }
  });

  /**
   * GET /api/v1/social/trending
   */
  router.get("/trending", optionalAuth, (req: Request, res: Response) => {
    const limit = Number(req.query["limit"]) || 10;
    try {
      const topics = database.getTopTrendingTopics(limit);
      res.json({ topics });
    } catch {
      res.status(500).json({ error: "Failed to fetch trending topics" });
    }
  });

  /**
   * GET /api/v1/social/topics/:concept/posts
   */
  router.get("/topics/:concept/posts", optionalAuth, (req: Request, res: Response) => {
    const concept = req.params["concept"] as string;
    const currentUserId = req.user?.id;
    const limit = Number(req.query["limit"]) || 20;
    const offset = Number(req.query["offset"]) || 0;
    const artifactType = (req.query["artifactType"] as string) || undefined;

    try {
      const posts = database.getTopicPosts(concept, currentUserId, limit, offset, artifactType);
      res.json({ posts });
    } catch {
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
          const ytRes = await safePublicFetch(`https://www.youtube.com/${encodeURIComponent(handle)}`);
          const ytHtml = await ytRes.text();
          const idMatch = ytHtml.match(/channel_id=([^"&']+)/);
          if (idMatch && idMatch[1]) {
            targetUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`;
            customUsername = `yt:channel:${idMatch[1]}`;
          } else {
            res.status(400).json({ error: "Could not find YouTube channel for that handle" });
            return;
          }
        } catch {
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
        // Fetch metadata via SSRF-safe client
        const rssRes = await safePublicFetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            Accept:
              "application/rss+xml, application/rdf+xml;q=0.8, application/atom+xml;q=0.6, application/xml;q=0.4, text/xml;q=0.4, text/html;q=0.2, */*;q=0.1",
          },
        });
        if (!rssRes.ok) {
          res.status(400).json({ error: `Failed to fetch RSS feed: HTTP ${rssRes.status}` });
          return;
        }
        const rssXml = await rssRes.text();
        const parser = new Parser();
        const parsed = await parser.parseString(rssXml);

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
        avatarUrl = avatarUrl || "";

        const feedId = database.createRssProfile(targetUrl, title, description, siteUrl, avatarUrl, customUsername);
        void feedId;
        feed = database.getRssFeedByUrl(targetUrl);
      }

      if (feed) {
        database.subscribeToRssFeed(userId, feed.id);
      }

      // Trigger RSS worker asynchronously to fetch items right away
      import("../util/rss-worker.js")
        .then(({ processRssFeeds }) => {
          void processRssFeeds(database);
        })
        .catch(console.error);

      res.status(200).json({ success: true, feed });
    } catch (err: unknown) {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to subscribe to RSS feed" });
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
    } catch {
      res.status(500).json({ error: "Failed to fetch feeds" });
    }
  });

  /**
   * DELETE /api/v1/social/feeds/:id/unsubscribe
   */
  router.delete("/feeds/:id/unsubscribe", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const feedId = Number(req.params["id"]);
    try {
      database.unsubscribeFromRssFeed(userId, feedId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to unsubscribe from feed" });
    }
  });

  const composerAi = new ComposerAIService(database);

  /**
   * POST /api/v1/social/ai/draft
   * Automatically drafts a post or tutorial section from an attached artifact using remote AI / domain classification.
   */
  router.post("/ai/draft", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { artifactId, artifact_id, artifactIds, artifactMeta, artifact_view, existingText, tone, isNotebook } =
      req.body as {
        artifactId?: number | undefined;
        artifact_id?: number | undefined;
        artifactIds?: number[] | undefined;
        artifactMeta?: {
          viewType?: string | undefined;
          title?: string | undefined;
          viewConfig?: Record<string, unknown> | string | undefined;
        };
        artifact_view?: Record<string, unknown> | undefined;
        existingText?: string | undefined;
        tone?: string | undefined;
        isNotebook?: boolean | undefined;
      };

    const resolvedArtifactId =
      typeof artifactId === "number"
        ? artifactId
        : typeof artifact_id === "number"
          ? artifact_id
          : Number.isFinite(Number(artifactId ?? artifact_id)) && (artifactId ?? artifact_id) !== undefined
            ? Number(artifactId ?? artifact_id)
            : undefined;

    const resolvedMeta =
      artifactMeta ||
      (artifact_view && typeof artifact_view === "object"
        ? {
            viewType: String(artifact_view["view_type"] || artifact_view["artifact_type"] || ""),
            title: typeof artifact_view["title"] === "string" ? artifact_view["title"] : undefined,
            viewConfig: (artifact_view["view_config"] as Record<string, unknown> | string | undefined) ?? artifact_view,
          }
        : undefined);

    if (
      resolvedArtifactId === undefined &&
      (!Array.isArray(artifactIds) || artifactIds.length === 0) &&
      !resolvedMeta
    ) {
      res.status(400).json({ error: "artifactId, artifactIds, or artifactMeta is required" });
      return;
    }

    const mappedTone: ComposerDraftTone =
      tone === "concise"
        ? "concise"
        : tone === "expand" || tone === "tutorial"
          ? "expand"
          : tone === "hashtags"
            ? "hashtags"
            : "technical";

    try {
      const result = await composerAi.draftFromArtifact({
        userId,
        artifactId: resolvedArtifactId,
        artifactIds: Array.isArray(artifactIds) ? artifactIds.map(Number).filter(Number.isFinite) : undefined,
        artifactMeta: resolvedMeta,
        existingText: typeof existingText === "string" ? existingText : undefined,
        tone: mappedTone,
        isNotebook: Boolean(isNotebook || tone === "tutorial"),
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to draft post from artifact" });
    }
  });

  /**
   * POST /api/v1/social/ai/polish
   * Polishes, condenses, expands, or tags existing composer text using remote AI / domain classification.
   */
  router.post("/ai/polish", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { content, text, mode, artifactId, artifact_id } = req.body as {
      content?: string | undefined;
      text?: string | undefined;
      mode?: ComposerPolishMode | undefined;
      artifactId?: number | undefined;
      artifact_id?: number | undefined;
    };

    const textContent = typeof content === "string" ? content : typeof text === "string" ? text : "";

    if (!textContent.trim() && artifactId === undefined && artifact_id === undefined) {
      res.status(400).json({ error: "Text content or attached artifactId is required to polish" });
      return;
    }

    const resolvedArtifactId =
      typeof artifactId === "number"
        ? artifactId
        : typeof artifact_id === "number"
          ? artifact_id
          : Number.isFinite(Number(artifactId ?? artifact_id)) && (artifactId ?? artifact_id) !== undefined
            ? Number(artifactId ?? artifact_id)
            : undefined;

    const validMode: ComposerPolishMode =
      mode === "concise" || mode === "expand" || mode === "hashtags" || mode === "polish" ? mode : "polish";

    try {
      const result = await composerAi.polishContent({
        userId,
        content: textContent,
        mode: validMode,
        artifactId: resolvedArtifactId,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to polish post content" });
    }
  });

  /**
   * POST /api/v1/social/posts/:id/poll/vote
   * Casts a vote on a post poll (local or federated Question)
   */
  router.post("/posts/:id/poll/vote", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const postId = Number(req.params["id"]);
    const rawChoices = req.body?.choices ?? (req.body?.choice !== undefined ? [req.body.choice] : []);
    const choices = Array.isArray(rawChoices) ? rawChoices.map(Number).filter(Number.isFinite) : [];

    if (choices.length === 0) {
      res.status(400).json({ error: "At least one choice index is required" });
      return;
    }

    try {
      const poll = database.votePostPoll(postId, choices, userId);

      // If this poll belongs to a remote actor, federate the vote as a Create(Note) reply with `name`
      const post = database.getPost(postId, userId);
      const voterFed = database.getUserFederationInfo(userId);
      const authorFed = post ? database.getUserFederationInfo(post.author_id) : undefined;
      if (
        post?.ap_id &&
        voterFed?.actor_url &&
        authorFed?.remote_domain &&
        authorFed?.inbox_url &&
        !isFederationDisabled(database.getInstanceSettings())
      ) {
        for (const choiceIdx of choices) {
          const opt = poll.options[choiceIdx];
          if (!opt) continue;
          const voteApId = `${voterFed.actor_url}/votes/${postId}-${choiceIdx}-${Date.now()}`;
          const voteActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `${voteApId}/activity`,
            type: "Create",
            actor: voterFed.actor_url,
            to: [authorFed.actor_url],
            object: {
              id: voteApId,
              type: "Note",
              attributedTo: voterFed.actor_url,
              inReplyTo: post.ap_id,
              name: opt.title,
              to: [authorFed.actor_url],
            },
          };
          database.enqueueFederationDelivery(
            "Create",
            `${voteApId}/activity`,
            voteActivity,
            authorFed.inbox_url,
            authorFed.remote_domain,
          );
        }
      }

      res.json({ poll });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to vote on poll" });
    }
  });

  /**
   * GET /api/v1/social/filters
   * Lists Mastodon v2-style keyword/phrase content filters for the authenticated user
   */
  router.get("/filters", requireAuth, (req: Request, res: Response) => {
    try {
      const filters = database.listContentFilters(req.user!.id);
      res.json({ filters });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list content filters" });
    }
  });

  /**
   * POST /api/v1/social/filters
   * Creates a new personal content filter
   */
  router.post("/filters", requireAuth, (req: Request, res: Response) => {
    const { title, context, filter_action, filterAction, keywords, keywords_attributes, expires_at, expiresAt } =
      req.body || {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "Filter title is required" });
      return;
    }
    try {
      const rawKeywords = Array.isArray(keywords)
        ? keywords
        : Array.isArray(keywords_attributes)
          ? keywords_attributes
          : [];
      const filter = database.createContentFilter({
        userId: req.user!.id,
        title: title.trim(),
        context: Array.isArray(context)
          ? context.map(String)
          : ["home", "public", "notifications", "thread", "account"],
        filterAction: filter_action || filterAction || "warn",
        keywords: rawKeywords.map((k: { keyword?: string; whole_word?: boolean } | string) =>
          typeof k === "string"
            ? { keyword: k, whole_word: true }
            : { keyword: String(k.keyword || ""), whole_word: k.whole_word !== false },
        ),
        expiresAt: expires_at ?? expiresAt ?? null,
      });
      res.status(201).json({ filter });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create content filter" });
    }
  });

  /**
   * PUT /api/v1/social/filters/:id
   */
  router.put("/filters/:id", requireAuth, (req: Request, res: Response) => {
    const filterId = Number(req.params["id"]);
    const { title, context, filter_action, filterAction, keywords, keywords_attributes, expires_at, expiresAt } =
      req.body || {};
    try {
      const rawKeywords = Array.isArray(keywords)
        ? keywords
        : Array.isArray(keywords_attributes)
          ? keywords_attributes
          : undefined;
      const filter = database.updateContentFilter(filterId, req.user!.id, {
        title: typeof title === "string" ? title.trim() : undefined,
        context: Array.isArray(context) ? context.map(String) : undefined,
        filterAction: filter_action || filterAction,
        keywords: rawKeywords
          ? rawKeywords.map((k: { keyword?: string; whole_word?: boolean } | string) =>
              typeof k === "string"
                ? { keyword: k, whole_word: true }
                : { keyword: String(k.keyword || ""), whole_word: k.whole_word !== false },
            )
          : undefined,
        expiresAt: expires_at !== undefined ? expires_at : expiresAt,
      });
      if (!filter) {
        res.status(404).json({ error: "Content filter not found" });
        return;
      }
      res.json({ filter });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to update content filter" });
    }
  });

  /**
   * DELETE /api/v1/social/filters/:id
   */
  router.delete("/filters/:id", requireAuth, (req: Request, res: Response) => {
    const filterId = Number(req.params["id"]);
    try {
      const deleted = database.deleteContentFilter(filterId, req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: "Content filter not found" });
        return;
      }
      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete content filter" });
    }
  });

  return router;
}
