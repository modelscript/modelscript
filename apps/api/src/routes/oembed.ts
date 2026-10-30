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
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";

function getEmbedSigningSecret(): string {
  return (
    process.env["EMBED_TOKEN_SECRET"] ||
    process.env["JWT_SECRET"] ||
    "modelscript-embed-intranet-signing-secret-default"
  );
}

export interface SignedEmbedTokenPayload {
  artifactId: string;
  allowedOrigins?: string[];
  exp: number;
  issuedBy?: number;
}

export function createSignedEmbedToken(payload: SignedEmbedTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getEmbedSigningSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySignedEmbedToken(
  token: string,
  expectedArtifactId?: string,
  requestOrigin?: string,
): { valid: boolean; payload?: SignedEmbedTokenPayload; reason?: string } {
  if (!token || !token.includes(".")) {
    return { valid: false, reason: "Malformed embed token" };
  }
  const [data, sig] = token.split(".");
  if (!data || !sig) {
    return { valid: false, reason: "Malformed embed token segments" };
  }
  const expectedSig = crypto.createHmac("sha256", getEmbedSigningSecret()).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: "Invalid embed token signature" };
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SignedEmbedTokenPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
      return { valid: false, reason: "Embed token has expired" };
    }
    if (expectedArtifactId && String(payload.artifactId) !== String(expectedArtifactId)) {
      return { valid: false, reason: "Embed token artifactId mismatch" };
    }
    if (
      requestOrigin &&
      Array.isArray(payload.allowedOrigins) &&
      payload.allowedOrigins.length > 0 &&
      !payload.allowedOrigins.includes("*") &&
      !payload.allowedOrigins.includes(requestOrigin)
    ) {
      return { valid: false, reason: `Origin '${requestOrigin}' is not authorized for this embed token` };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "Invalid embed token payload" };
  }
}

export function renderStandaloneEmbedBundle(defaultHost: string = ""): string {
  return `// ModelScript Standalone Intranet Embed SDK v1.0.0
(function(global) {
  "use strict";
  var SCRIPT_ORIGIN = ${JSON.stringify(defaultHost)} || (document.currentScript && document.currentScript.src ? new URL(document.currentScript.src, window.location.href).origin : window.location.origin);

  class ModelScriptViewerElement extends HTMLElement {
    static get observedAttributes() {
      return ["src", "morsel", "artifact-id", "embed-token", "code", "dialect", "view", "theme", "height", "host"];
    }
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: "open" });
      this._iframe = null;
      this._ready = false;
      this._queue = [];
      this._boundOnMessage = this._onMessage.bind(this);
    }
    connectedCallback() {
      window.addEventListener("message", this._boundOnMessage);
      this._render();
    }
    disconnectedCallback() {
      window.removeEventListener("message", this._boundOnMessage);
    }
    attributeChangedCallback() {
      if (this.isConnected) this._render();
    }
    _targetOrigin() {
      var host = this.getAttribute("host") || SCRIPT_ORIGIN;
      try { return new URL(host, window.location.href).origin; } catch (e) { return "*"; }
    }
    _buildUrl() {
      var directSrc = this.getAttribute("src");
      if (directSrc) {
        var trimmedSrc = String(directSrc).trim();
        if (trimmedSrc.startsWith("/") && !trimmedSrc.startsWith("//")) return trimmedSrc;
        try {
          var parsedSrc = new URL(trimmedSrc, window.location.href);
          if (parsedSrc.protocol === "https:" || parsedSrc.protocol === "http:") return parsedSrc.toString();
        } catch (e) {}
      }
      var host = (this.getAttribute("host") || SCRIPT_ORIGIN).replace(/\\/$/, "");
      var params = new URLSearchParams();
      var morsel = this.getAttribute("morsel");
      var artifactId = this.getAttribute("artifact-id");
      var embedToken = this.getAttribute("embed-token");
      var view = this.getAttribute("view");
      var theme = this.getAttribute("theme");
      var dialect = this.getAttribute("dialect");
      var code = this.getAttribute("code") || (this.textContent ? this.textContent.trim() : "");
      if (morsel) params.set("morsel", morsel);
      if (artifactId) params.set("fromArtifact", artifactId);
      if (embedToken) params.set("embed_token", embedToken);
      if (view) params.set("view", view);
      if (theme) params.set("theme", theme);
      if (dialect) params.set("dialect", dialect);
      if (code && !morsel && !artifactId) params.set("code", code);
      var qs = params.toString();
      return host + "/embed/playground" + (qs ? "?" + qs : "");
    }
    _render() {
      var rawHeight = this.getAttribute("height") || "480px";
      var height = /^[0-9]+(\\.[0-9]+)?(px|%|vh|vw|rem|em)?$/.test(rawHeight.trim()) ? rawHeight.trim() : "480px";
      var url = this._buildUrl();
      this._ready = false;
      this._shadow.innerHTML =
        "<style>:host{display:block;width:100%;border-radius:8px;overflow:hidden;border:1px solid rgba(128,128,128,0.25);}iframe{width:100%;height:" +
        height +
        ";border:0;display:block;background:#0d1117;}</style>" +
        '<iframe part="iframe" allow="fullscreen; clipboard-write" loading="lazy"></iframe>';
      this._iframe = this._shadow.querySelector("iframe");
      if (this._iframe) this._iframe.src = url;
    }
    _onMessage(ev) {
      if (!this._iframe || ev.source !== this._iframe.contentWindow) return;
      var expected = this._targetOrigin();
      if (expected !== "*" && ev.origin !== expected) return;
      var msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.namespace !== "modelscript-embed") return;
      if (msg.type === "EMBED_READY") {
        this._ready = true;
        while (this._queue.length > 0) {
          this._post(this._queue.shift());
        }
      }
      this.dispatchEvent(new CustomEvent("modelscript-message", { detail: msg, bubbles: true, composed: true }));
    }
    _post(payload) {
      if (!this._iframe || !this._iframe.contentWindow) return;
      var msg = Object.assign({ namespace: "modelscript-embed" }, payload);
      if (!this._ready) {
        this._queue.push(msg);
        return;
      }
      this._iframe.contentWindow.postMessage(msg, this._targetOrigin());
    }
    setParam(name, value) {
      this._post({ type: "SET_PARAM", name: name, value: value });
    }
    simulate(options) {
      this._post(Object.assign({ type: "TRIGGER_SIMULATE" }, options || {}));
    }
    setTheme(theme) {
      this._post({ type: "SET_THEME", theme: theme });
    }
  }

  function registerViewerElement() {
    if (typeof customElements !== "undefined") {
      if (!customElements.get("modelscript-viewer")) {
        customElements.define("modelscript-viewer", ModelScriptViewerElement);
      }
      if (!customElements.get("modelscript-morsel")) {
        customElements.define("modelscript-morsel", class ModelScriptMorselElement extends ModelScriptViewerElement {});
      }
    }
  }

  function rehydrateEmbeds(root) {
    registerViewerElement();
    var container = root || document;
    var nodes = container.querySelectorAll("blockquote.modelscript-embed, [data-modelscript-embed]");
    var count = 0;
    nodes.forEach(function(node) {
      if (node.getAttribute("data-ms-hydrated") === "true") return;
      node.setAttribute("data-ms-hydrated", "true");
      var el = document.createElement("modelscript-morsel");
      ["morsel", "artifact-id", "embed-token", "view", "theme", "height", "dialect", "src", "host"].forEach(function(attr) {
        var val = node.getAttribute("data-" + attr) || node.getAttribute(attr);
        if (val) el.setAttribute(attr, val);
      });
      var link = node.querySelector("a[href]");
      if (link && !el.getAttribute("src") && !el.getAttribute("morsel")) {
        el.setAttribute("src", link.getAttribute("href"));
      }
      node.replaceWith(el);
      count++;
    });
    return count;
  }

  registerViewerElement();
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() { rehydrateEmbeds(document); });
    } else {
      rehydrateEmbeds(document);
    }
  }

  global.ModelScriptEmbed = {
    version: "1.0.0",
    ModelScriptViewerElement: ModelScriptViewerElement,
    registerViewerElement: registerViewerElement,
    rehydrateEmbeds: rehydrateEmbeds
  };
})(typeof window !== "undefined" ? window : globalThis);
`;
}

export function oembedRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  // ── Standalone Browser Bundle for <modelscript-morsel> / <modelscript-viewer> ──
  router.get("/embed.js", (req: Request, res: Response): void => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const origin = `${String(protocol).split(",")[0]!.trim()}://${String(hostHeader).split(",")[0]!.trim()}`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(renderStandaloneEmbedBundle(origin));
  });

  // ── Short-Link Morsel Snippet Storage (Solves URL length limits for large models) ──
  router.post("/morsels", optionalAuth, (req: Request, res: Response): void => {
    const { code, dialect, lang, title, view, payload } = req.body ?? {};
    if (typeof code !== "string" || code.trim().length === 0) {
      res.status(400).json({ error: "Field 'code' is required and must be a non-empty string." });
      return;
    }
    if (code.length > 2 * 1024 * 1024) {
      res.status(413).json({ error: "Morsel snippet exceeds maximum size of 2 MB." });
      return;
    }

    const effectiveDialect = String(dialect || lang || "modelica").slice(0, 64);
    const effectiveTitle = typeof title === "string" ? title.slice(0, 200) : null;
    const effectiveView = typeof view === "string" ? view.slice(0, 32) : "diagram";
    const serializedPayload = JSON.stringify({
      ...(payload && typeof payload === "object" ? payload : {}),
      v: 1,
      lang: effectiveDialect,
      code,
      ...(effectiveTitle ? { title: effectiveTitle } : {}),
      view: effectiveView,
    });
    if (serializedPayload.length > 2.5 * 1024 * 1024) {
      res.status(413).json({ error: "Morsel payload exceeds maximum size of 2.5 MB." });
      return;
    }

    const id = database.saveMorselSnippet(serializedPayload, effectiveDialect, effectiveTitle, req.user?.id ?? null);

    res.status(201).json({
      id,
      dialect: effectiveDialect,
      title: effectiveTitle,
      view: effectiveView,
      embedUrl: `/embed/playground?morsel=${id}`,
    });
  });

  router.get("/morsels/:id", (req: Request, res: Response): void => {
    const rawId = req.params["id"];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id) {
      res.status(400).json({ error: "Missing morsel ID" });
      return;
    }
    const snippet = database.getMorselSnippet(id);
    if (!snippet) {
      res.status(404).json({ error: "Morsel snippet not found" });
      return;
    }
    let parsedPayload: Record<string, unknown> = {};
    if (snippet.payload_json) {
      try {
        parsedPayload = JSON.parse(snippet.payload_json) as Record<string, unknown>;
      } catch {
        parsedPayload = {};
      }
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      id: snippet.id,
      dialect: snippet.dialect,
      code: typeof parsedPayload["code"] === "string" ? parsedPayload["code"] : "",
      title: snippet.title ?? (typeof parsedPayload["title"] === "string" ? parsedPayload["title"] : null),
      view: typeof parsedPayload["view"] === "string" ? parsedPayload["view"] : "diagram",
      payload: parsedPayload,
      created_at: snippet.created_at,
    });
  });

  // ── Signed Intranet Embed Tokens (Cookie-free authentication for cross-origin iframes) ──
  router.post("/artifacts/:id/embed-token", requireAuth, (req: Request, res: Response): void => {
    const rawId = req.params["id"];
    const artifactId = String(Array.isArray(rawId) ? rawId[0] : (rawId ?? ""));
    if (!artifactId) {
      res.status(400).json({ error: "Missing artifact ID" });
      return;
    }
    const { allowedOrigins, ttlSeconds } = req.body ?? {};
    const ttl = Math.min(Math.max(Number(ttlSeconds) || 86400 * 7, 60), 86400 * 365);
    const origins = Array.isArray(allowedOrigins)
      ? allowedOrigins.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : undefined;

    const exp = Date.now() + ttl * 1000;
    const token = createSignedEmbedToken({
      artifactId,
      ...(origins ? { allowedOrigins: origins } : {}),
      exp,
      ...(req.user?.id ? { issuedBy: req.user.id } : {}),
    });

    res.status(201).json({
      artifactId,
      embedToken: token,
      expiresAt: new Date(exp).toISOString(),
      embedUrl: `/embed/playground?fromArtifact=${encodeURIComponent(artifactId)}&embed_token=${encodeURIComponent(token)}`,
    });
  });

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

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      res.status(400).json({ error: "Invalid URL protocol; only http and https are supported" });
      return;
    }

    const settings = database.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    const host = parsedUrl.origin;
    let title = `${brandName} Interactive Engineering Model`;
    let authorName = `${brandName} Community`;
    let authorUrl = host;
    let thumbnailUrl = `${host}/api/v1/artifacts/default-thumb.webp`;
    let embedSrc = "";

    // 1. Check if URL references a stored morsel snippet (?morsel=<id>)
    const morselId = parsedUrl.searchParams.get("morsel");
    if (morselId) {
      const snippet = database.getMorselSnippet(morselId);
      if (snippet) {
        title = snippet.title || `${snippet.dialect.toUpperCase()} Engineering Simulation`;
      }
      embedSrc = `${host}/embed/playground?morsel=${encodeURIComponent(morselId)}`;
    }

    // 2. Check if URL contains compressed Morsel/Embed permalink hash (#m=...)
    if (!embedSrc && parsedUrl.hash && parsedUrl.hash.includes("m=")) {
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

    // 3. Check if URL is a social post permalink (/p/:id or /posts/:id)
    const postMatch = parsedUrl.pathname.match(/\/(?:p|posts)\/(\d+)/);
    if (postMatch && postMatch[1]) {
      const postId = parseInt(postMatch[1], 10);
      try {
        const post = database.getPost(postId);
        if (post) {
          const postExt = post as typeof post & {
            author?: { display_name?: string | undefined; username?: string | undefined } | undefined;
            artifact_id?: number | string | null | undefined;
          };
          title = post.title || post.content?.slice(0, 60) || title;
          const author = post.display_name || post.username || postExt.author?.display_name || postExt.author?.username;
          if (author) {
            authorName = author;
            authorUrl = `${host}/u/${post.username || postExt.author?.username || ""}`;
          }
          if (post.thumbnail_url) {
            thumbnailUrl = post.thumbnail_url;
          }
          if (!embedSrc && (postExt.artifact_id || post.artifact_view_id)) {
            const artId = postExt.artifact_id || post.artifact_view_id;
            embedSrc = `${host}/embed/playground#m=artifact-${artId}`;
          }
        }
      } catch {
        // Fall back to default title
      }
    }

    // 4. Check if URL is a direct artifact viewer link (/render-artifact/:id or ?fromArtifact=:id)
    const fromArtifactParam = parsedUrl.searchParams.get("fromArtifact");
    const renderArtifactMatch = parsedUrl.pathname.match(/\/render-artifact\/([^/]+)/);
    if (!embedSrc && (fromArtifactParam || renderArtifactMatch?.[1])) {
      const artId = fromArtifactParam || renderArtifactMatch![1]!;
      embedSrc = `${host}/embed/playground?fromArtifact=${encodeURIComponent(artId)}#m=artifact-${encodeURIComponent(artId)}`;
    }

    // Default fallback embed src if none derived
    if (!embedSrc) {
      embedSrc = `${host}/embed/playground${parsedUrl.search || ""}${parsedUrl.hash || ""}`;
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
      provider_name: brandName,
      provider_url: host,
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
