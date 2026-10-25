// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * oEmbed Provider Route (https://oembed.com/)
 *
 * Implements the standard oEmbed protocol endpoint:
 *   GET /api/v1/oembed?url=...&format=json
 *
 * Enables automatic rich interactive iframe and preview card embedding in
 * Notion, Slack, Discord, Twitter, Reddit, Discourse, and Medium.
 */

import { decompressEmbedPayload } from "@modelscript/embed";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";

export function oembedRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  router.get("/oembed", (req: Request, res: Response): void => {
    const rawUrl = req.query["url"] as string;
    const format = (req.query["format"] as string) || "json";
    const maxWidth = parseInt(req.query["maxwidth"] as string, 10) || 800;
    const maxHeight = parseInt(req.query["maxheight"] as string, 10) || 520;

    if (!rawUrl) {
      res.status(400).json({ error: "Missing required 'url' parameter" });
      return;
    }

    if (format.toLowerCase() !== "json") {
      res.status(501).json({ error: "Only JSON format is supported by this oEmbed provider" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Invalid URL provided" });
      return;
    }

    const host = parsedUrl.origin;
    let title = "ModelScript Interactive Engineering Model";
    let authorName = "ModelScript Community";
    let authorUrl = host;
    let thumbnailUrl = `${host}/api/v1/artifacts/default-thumb.webp`;
    let embedSrc = "";

    // 1. Check if URL contains compressed Morsel/Embed permalink hash (#m=...)
    if (parsedUrl.hash && parsedUrl.hash.includes("m=")) {
      const hashPart = parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash;
      const mIdx = hashPart.indexOf("m=");
      const token = mIdx !== -1 ? hashPart.slice(mIdx + 2) : "";
      if (token) {
        const payload = decompressEmbedPayload(token);
        if (payload) {
          if (payload.title) {
            title = payload.title;
          } else if (payload.lang) {
            title = `${payload.lang.toUpperCase()} Engineering Simulation`;
          }
          if (payload.anchor?.elementId) {
            title += ` (${payload.anchor.elementId})`;
          }
        }
      }
      embedSrc = `${host}/embed/playground#m=${token}`;
    }

    // 2. Check if URL is a social post permalink (/p/:id or /posts/:id)
    const postMatch = parsedUrl.pathname.match(/\/(?:p|posts)\/(\d+)/);
    if (postMatch && postMatch[1]) {
      const postId = parseInt(postMatch[1], 10);
      try {
        const post = database.getPost(postId);
        if (post) {
          title = post.title || post.content?.slice(0, 60) || title;
          const author = post.display_name || post.username || post.author?.display_name || post.author?.username;
          if (author) {
            authorName = author;
            authorUrl = `${host}/u/${post.username || post.author?.username || ""}`;
          }
          if (post.thumbnail_url) {
            thumbnailUrl = post.thumbnail_url;
          }
          if (!embedSrc && (post.artifact_id || post.artifact_view_id)) {
            const artId = post.artifact_id || post.artifact_view_id;
            embedSrc = `${host}/embed/playground#m=artifact-${artId}`;
          }
        }
      } catch {
        // Fall back to default title
      }
    }

    // Default fallback embed src if none derived
    if (!embedSrc) {
      embedSrc = `${host}/embed/playground${parsedUrl.hash || ""}`;
    }

    const width = Math.min(maxWidth, 1200);
    const height = Math.min(maxHeight, 800);

    const escapeHtmlAttr = (str: string): string =>
      str
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const safeEmbedSrc = escapeHtmlAttr(embedSrc);
    const iframeHtml = `<iframe src="${safeEmbedSrc}" width="100%" height="${height}" frameborder="0" allow="camera; microphone; display-capture; fullscreen" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads" style="border: 1px solid rgba(6,182,212,0.3); border-radius: 8px;"></iframe>`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400"); // 24h cache

    res.json({
      type: "rich",
      version: "1.0",
      title,
      author_name: authorName,
      author_url: authorUrl,
      provider_name: "ModelScript",
      provider_url: "https://modelscript.org",
      cache_age: 86400,
      thumbnail_url: thumbnailUrl,
      thumbnail_width: 1200,
      thumbnail_height: 630,
      width,
      height,
      html: iframeHtml,
    });
  });

  return router;
}
