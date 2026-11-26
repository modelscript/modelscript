// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic OpenGraph Preview Image Route
 *
 * Provides real-time, deterministic 1200x630 vector preview cards and raster PNGs for:
 *   - /api/v1/og/post/:id(.png)?
 *   - /api/v1/og/package/:scope?/:name(.png)?
 *   - /api/v1/og/class/:scope?/:name/:version/:className(.png)?
 *   - /api/v1/og/brand(.png)?
 */

import { Resvg } from "@resvg/resvg-js";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { escapeXml } from "../util/escape.js";
import {
  extractPostTitle,
  renderBrandOgSvg,
  renderClassOgSvg,
  renderPackageOgSvg,
  renderPostOgSvg,
} from "../util/og-renderer.js";
import { resolveRequestHost } from "../util/seo-injector.js";
import { isCorporateOrAirgapTier } from "../util/tier-presets.js";

export const TRAINING_RECIPE_VIEW_TYPES = [
  "training-recipe",
  "memory-shard",
  "dataset-pretrain",
  "dataset-posttrain",
] as const;

export type TrainingRecipeViewType = (typeof TRAINING_RECIPE_VIEW_TYPES)[number];

const TRAINING_RECIPE_VIEW_TYPE_SET = new Set<string>(TRAINING_RECIPE_VIEW_TYPES);

export function isTrainingRecipeViewType(viewType: string | null | undefined): viewType is TrainingRecipeViewType {
  return typeof viewType === "string" && TRAINING_RECIPE_VIEW_TYPE_SET.has(viewType.trim().toLowerCase());
}

export interface TrainingRecipeOgEvalMetrics {
  gate1To4PassRate?: number | undefined;
  passAt1?: number | undefined;
  simRmse?: number | undefined;
  independentReproductions?: number | undefined;
}

export interface TrainingRecipeOgInput {
  id?: number | string | undefined;
  title?: string | null | undefined;
  content?: string | null | undefined;
  username?: string | null | undefined;
  display_name?: string | null | undefined;
  view_type?: string | null | undefined;
  view_config?: string | Record<string, unknown> | null | undefined;
  packageName?: string | undefined;
  version?: string | undefined;
  baseModel?: string | undefined;
  parameterScale?: string | undefined;
  mode?: string | undefined;
  mStart?: number | undefined;
  mMax?: number | undefined;
  mCap?: number | undefined;
  embedderId?: string | undefined;
  dimension?: number | undefined;
  quantization?: string | undefined;
  evalMetrics?: TrainingRecipeOgEvalMetrics | undefined;
}

export interface ParsedTrainingRecipePreview {
  kind: TrainingRecipeViewType;
  title: string;
  packageRef: string | undefined;
  baseModel: string | undefined;
  parameterScale: string | undefined;
  mode: string | undefined;
  mStart: number | undefined;
  mMax: number | undefined;
  mCap: number | undefined;
  embedderId: string | undefined;
  dimension: number | undefined;
  quantization: string | undefined;
  gate1To4PassRate: number | undefined;
  passAt1: number | undefined;
  simRmse: number | undefined;
  independentReproductions: number | undefined;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : undefined;
}

function asNonEmptyString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

function asFiniteNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function formatOgPercent(val: number): string {
  const pct = val <= 1 && val >= 0 ? val * 100 : val;
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export function formatOgRmse(val: number): string {
  if (val === 0) return "0";
  if (Math.abs(val) < 1e-3 || Math.abs(val) >= 1e4) return val.toExponential(2);
  return Number(val.toPrecision(3)).toString();
}

export function parseTrainingRecipePreview(
  input: TrainingRecipeOgInput,
  defaultTitle: string = "Ansatz ML Artifact",
): ParsedTrainingRecipePreview {
  let rawCfg: Record<string, unknown> = {};
  if (typeof input.view_config === "string" && input.view_config.trim().length > 0) {
    try {
      const parsed = JSON.parse(input.view_config) as unknown;
      rawCfg = asRecord(parsed) ?? {};
    } catch {
      rawCfg = {};
    }
  } else if (input.view_config && typeof input.view_config === "object") {
    rawCfg = asRecord(input.view_config) ?? {};
  }

  const mlObj = asRecord(rawCfg["ml"]) ?? asRecord(rawCfg["recipe"]) ?? rawCfg;
  const targetModel = asRecord(mlObj["targetModel"]) ?? asRecord(rawCfg["targetModel"]);
  const dynamicM = asRecord(mlObj["dynamicM"]) ?? asRecord(rawCfg["dynamicM"]);
  const memoryContract = asRecord(mlObj["memoryContract"]) ?? asRecord(rawCfg["memoryContract"]);
  const evalObj =
    asRecord(rawCfg["evalMetrics"]) ??
    asRecord(rawCfg["eval"]) ??
    asRecord(mlObj["evalMetrics"]) ??
    asRecord(mlObj["eval"]) ??
    {};

  const rawKind = (
    asNonEmptyString(input.view_type) ||
    asNonEmptyString(mlObj["kind"]) ||
    asNonEmptyString(rawCfg["kind"]) ||
    "training-recipe"
  ).toLowerCase();
  const kind: TrainingRecipeViewType = isTrainingRecipeViewType(rawKind) ? rawKind : "training-recipe";

  const packageName =
    asNonEmptyString(input.packageName) ||
    asNonEmptyString(rawCfg["packageName"]) ||
    asNonEmptyString(rawCfg["name"]) ||
    asNonEmptyString(mlObj["packageName"]);
  const version =
    asNonEmptyString(input.version) || asNonEmptyString(rawCfg["version"]) || asNonEmptyString(mlObj["version"]);
  const packageRef = packageName ? (version ? `${packageName}@${version}` : packageName) : undefined;

  const title =
    asNonEmptyString(input.title) ||
    asNonEmptyString(rawCfg["title"]) ||
    packageRef ||
    extractPostTitle({ title: input.title, content: input.content }, defaultTitle);

  const baseModel = asNonEmptyString(input.baseModel) || asNonEmptyString(targetModel?.["baseModel"]);
  const parameterScale = asNonEmptyString(input.parameterScale) || asNonEmptyString(targetModel?.["parameterScale"]);
  const mode = asNonEmptyString(input.mode) || asNonEmptyString(targetModel?.["mode"]);

  const mStart = asFiniteNumber(input.mStart) ?? asFiniteNumber(dynamicM?.["mStart"]);
  const mMax = asFiniteNumber(input.mMax) ?? asFiniteNumber(dynamicM?.["mMax"]);
  const mCap = asFiniteNumber(input.mCap) ?? asFiniteNumber(dynamicM?.["mCap"]);

  const embedderId =
    asNonEmptyString(input.embedderId) ||
    asNonEmptyString(memoryContract?.["embedderId"]) ||
    asNonEmptyString(mlObj["embedderId"]) ||
    asNonEmptyString(rawCfg["embedderId"]);
  const dimension = asFiniteNumber(input.dimension) ?? asFiniteNumber(memoryContract?.["dimension"]);
  const quantization = asNonEmptyString(input.quantization) || asNonEmptyString(memoryContract?.["quantization"]);

  const gate1To4PassRate =
    asFiniteNumber(input.evalMetrics?.gate1To4PassRate) ?? asFiniteNumber(evalObj["gate1To4PassRate"]);
  const passAt1 = asFiniteNumber(input.evalMetrics?.passAt1) ?? asFiniteNumber(evalObj["passAt1"]);
  const simRmse = asFiniteNumber(input.evalMetrics?.simRmse) ?? asFiniteNumber(evalObj["simRmse"]);
  const independentReproductions =
    asFiniteNumber(input.evalMetrics?.independentReproductions) ?? asFiniteNumber(evalObj["independentReproductions"]);

  return {
    kind,
    title,
    packageRef,
    baseModel,
    parameterScale,
    mode,
    mStart,
    mMax,
    mCap,
    embedderId,
    dimension,
    quantization,
    gate1To4PassRate,
    passAt1,
    simRmse,
    independentReproductions,
  };
}

function wrapOgLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > maxCharsPerLine ? `${word.slice(0, maxCharsPerLine - 1)}…` : word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function truncateOg(str: string, maxLen: number): string {
  const clean = str.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

const KIND_STYLES: Record<
  TrainingRecipeViewType,
  { badge: string; accent: string; accentBg: string; gradEnd: string }
> = {
  "training-recipe": {
    badge: "TRAINING RECIPE",
    accent: "#c084fc",
    accentBg: "rgba(192, 132, 252, 0.14)",
    gradEnd: "#a855f7",
  },
  "memory-shard": {
    badge: "MEMORY SHARD",
    accent: "#22d3ee",
    accentBg: "rgba(34, 211, 238, 0.14)",
    gradEnd: "#06b6d4",
  },
  "dataset-pretrain": {
    badge: "PRETRAIN DATASET",
    accent: "#38bdf8",
    accentBg: "rgba(56, 189, 248, 0.14)",
    gradEnd: "#0284c7",
  },
  "dataset-posttrain": {
    badge: "POSTTRAIN DATASET",
    accent: "#34d399",
    accentBg: "rgba(52, 211, 153, 0.14)",
    gradEnd: "#10b981",
  },
};

/**
 * Renders a 1200x630 OpenGraph SVG card tailored for `training-recipe`, `memory-shard`,
 * `dataset-pretrain`, and `dataset-posttrain` posts.
 */
export function renderTrainingRecipeOgSvg(
  input: TrainingRecipeOgInput,
  host: string = "https://ansatz.social",
  brandName: string = "Ansatz",
): string {
  const parsed = parseTrainingRecipePreview(input, `${brandName} Training Recipe`);
  const style = KIND_STYLES[parsed.kind];
  const authorName = input.display_name || input.username || `${brandName} Engineer`;
  const authorHandle = `@${input.username || "engineer"}`;
  const initial = (authorName.charAt(0) || "A").toUpperCase();

  const titleLines = wrapOgLines(parsed.title, 30, 2);
  const scaleModeParts = [parsed.parameterScale, parsed.mode].filter(Boolean);
  const scaleModeLabel = scaleModeParts.join(" · ");
  const dynamicMLabel =
    parsed.mStart !== undefined && parsed.mMax !== undefined
      ? `m: ${parsed.mStart}→${parsed.mMax}${parsed.mCap !== undefined ? ` (cap ${parsed.mCap})` : ""}`
      : undefined;

  const evalBadges: Array<{ label: string; color: string; bg: string }> = [];
  if (parsed.gate1To4PassRate !== undefined) {
    evalBadges.push({
      label: `Gate 1–4: ${formatOgPercent(parsed.gate1To4PassRate)}`,
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.14)",
    });
  }
  if (parsed.passAt1 !== undefined) {
    evalBadges.push({
      label: `Pass@1: ${formatOgPercent(parsed.passAt1)}`,
      color: "#38bdf8",
      bg: "rgba(56, 189, 248, 0.14)",
    });
  }
  if (parsed.simRmse !== undefined) {
    evalBadges.push({
      label: `Sim RMSE: ${formatOgRmse(parsed.simRmse)}`,
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.14)",
    });
  }
  if (parsed.independentReproductions !== undefined) {
    evalBadges.push({
      label: `${parsed.independentReproductions}× Reproduced`,
      color: "#c084fc",
      bg: "rgba(192, 132, 252, 0.14)",
    });
  }

  const badgeElements = evalBadges
    .map((b, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col * 204;
      const y = row * 46;
      return `<g transform="translate(${x}, ${y})">
        <rect x="0" y="0" width="192" height="36" rx="8" fill="${b.bg}" stroke="${b.color}" stroke-width="1.2"/>
        <text x="96" y="23" text-anchor="middle" fill="${b.color}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="13" font-weight="700">${escapeXml(b.label)}</text>
      </g>`;
    })
    .join("\n      ");

  const specRows: Array<{ key: string; val: string }> = [];
  if (parsed.baseModel) {
    specRows.push({ key: "BASE MODEL", val: truncateOg(parsed.baseModel, 42) });
  }
  if (scaleModeLabel) {
    specRows.push({ key: "SCALE & MODE", val: truncateOg(scaleModeLabel, 42) });
  }
  if (dynamicMLabel) {
    specRows.push({ key: "DYNAMIC-M", val: dynamicMLabel });
  }
  if (parsed.embedderId) {
    const embDetail = [
      parsed.embedderId,
      parsed.dimension !== undefined ? `${parsed.dimension}d` : undefined,
      parsed.quantization,
    ]
      .filter(Boolean)
      .join(" · ");
    specRows.push({ key: "EMBEDDER", val: truncateOg(embDetail, 42) });
  }
  if (specRows.length === 0) {
    specRows.push({ key: "ARTIFACT KIND", val: parsed.kind });
  }

  const specRowsSvg = specRows
    .slice(0, 4)
    .map(
      (row, idx) => `<g transform="translate(0, ${idx * 56})">
        <text x="0" y="14" fill="#64748b" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700" letter-spacing="1.2">${escapeXml(row.key)}</text>
        <text x="0" y="38" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14" font-weight="600">${escapeXml(row.val)}</text>
      </g>`,
    )
    .join("\n      ");

  const postPath = input.id !== undefined && input.id !== null ? `/p/${input.id}` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>${escapeXml(parsed.title)}</title>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080c16" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#19153e" />
    </linearGradient>
    <linearGradient id="accentBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="${style.accent}" />
      <stop offset="100%" stop-color="${style.gradEnd}" />
    </linearGradient>
    <linearGradient id="panelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#111827" />
      <stop offset="100%" stop-color="#0b0f19" />
    </linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(56, 189, 248, 0.04)" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="#1e293b" stroke-width="2" />
  <rect x="36" y="36" width="1128" height="5" rx="2.5" fill="url(#accentBar)" />

  <!-- Top Bar: Brand & Artifact Kind Badge -->
  <g transform="translate(76, 76)">
    <text x="0" y="20" fill="#38bdf8" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="3">${escapeXml(brandName.toUpperCase())} · VERIFIED ML ARTIFACT</text>
    <rect x="760" y="0" width="260" height="32" rx="16" fill="${style.accentBg}" stroke="${style.accent}" stroke-width="1.5"/>
    <text x="890" y="21" text-anchor="middle" fill="${style.accent}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="12" font-weight="700" letter-spacing="1.5">${escapeXml(style.badge)}</text>
  </g>

  <!-- Left Column: Author, Title, Package@Version & Eval Badges -->
  <g transform="translate(76, 140)">
    <circle cx="24" cy="24" r="24" fill="#1e293b" stroke="${style.accent}" stroke-width="1.5" />
    <text x="24" y="31" text-anchor="middle" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700">${escapeXml(initial)}</text>
    <text x="64" y="20" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700">${escapeXml(truncateOg(authorName, 32))}</text>
    <text x="64" y="40" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14">${escapeXml(truncateOg(authorHandle, 32))}</text>

    <text x="0" y="106" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800">
      ${titleLines.map((line, idx) => `<tspan x="0" dy="${idx === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`).join("")}
    </text>

    ${
      parsed.packageRef
        ? `<g transform="translate(0, ${116 + titleLines.length * 42})">
      <rect x="0" y="0" width="460" height="32" rx="8" fill="rgba(30, 41, 59, 0.9)" stroke="#334155" stroke-width="1"/>
      <text x="14" y="21" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, monospace" font-size="13" font-weight="600">${escapeXml(truncateOg(parsed.packageRef, 48))}</text>
    </g>`
        : ""
    }

    <!-- Verified Eval Badges -->
    <g transform="translate(0, 290)">
      ${badgeElements}
    </g>
  </g>

  <!-- Right Column: Model, Dynamic-m & Embedder Specification Card -->
  <g transform="translate(670, 136)">
    <rect x="0" y="0" width="440" height="380" rx="16" fill="url(#panelGrad)" stroke="#334155" stroke-width="1.5"/>
    <rect x="0" y="0" width="440" height="38" rx="16" fill="#1e293b" />
    <rect x="0" y="24" width="440" height="14" fill="#1e293b" />
    <circle cx="20" cy="19" r="5" fill="#ef4444" />
    <circle cx="36" cy="19" r="5" fill="#f59e0b" />
    <circle cx="52" cy="19" r="5" fill="#10b981" />
    <text x="220" y="24" text-anchor="middle" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11" font-weight="600">${escapeXml(parsed.kind)}.manifest.json</text>

    <g transform="translate(28, 66)">
      ${specRowsSvg}
    </g>

    <g transform="translate(24, 326)">
      <rect x="0" y="0" width="392" height="32" rx="6" fill="rgba(15, 23, 42, 0.9)" stroke="#1e293b"/>
      <text x="14" y="21" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="11">4-Gate Formal Verifier · Dynamic-m Zonotope</text>
    </g>
  </g>

  <!-- Bottom Footer -->
  <g transform="translate(76, 552)">
    <text x="0" y="0" fill="#64748b" font-family="ui-monospace, monospace" font-size="13">${escapeXml(`${host}${postPath}`)}</text>
    <text x="1048" y="0" text-anchor="end" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Reproducible Small-LLM Training &amp; DiskANN Memory</text>
  </g>
</svg>
`;
}

const pngCache = new Map<string, Buffer>();
const MAX_PNG_CACHE = 250;

function convertSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

function sendOgResponse(
  _req: Request,
  res: Response,
  svg: string,
  cacheKey: string,
  isPngRequested: boolean,
  isCorporate: boolean,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Cache-Control",
    isCorporate ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=604800",
  );

  if (isPngRequested) {
    let png = pngCache.get(cacheKey);
    if (!png) {
      try {
        png = convertSvgToPng(svg);
        if (pngCache.size >= MAX_PNG_CACHE) {
          const firstKey = pngCache.keys().next().value;
          if (firstKey) pngCache.delete(firstKey);
        }
        pngCache.set(cacheKey, png);
      } catch (err) {
        console.error("[OG] Failed to render SVG to PNG:", err);
      }
    }

    if (png) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(png.length));
      res.send(png);
      return;
    }
  }

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.send(svg);
}

function isPngTarget(paramName: string, req: Request): boolean {
  if (paramName.endsWith(".png")) return true;
  if (req.query["format"] === "png") return true;
  const accept = req.headers["accept"] || "";
  if (accept.includes("image/png") && !accept.includes("image/svg+xml")) return true;
  return false;
}

export function ogRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  function getParam(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0] || "";
    return param || "";
  }

  function getBaseContext(req: Request) {
    const settings = database.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    const host = resolveRequestHost(req);
    const isCorporate = isCorporateOrAirgapTier(settings);
    return { brandName, host, isCorporate };
  }

  // ── Brand OpenGraph Card ──
  const handleBrandOg = (req: Request, res: Response): void => {
    const { brandName, host, isCorporate } = getBaseContext(req);
    const isPng = req.path.endsWith(".png") || req.query["format"] === "png";
    const svg = renderBrandOgSvg(host, brandName);
    sendOgResponse(req, res, svg, `brand:${brandName}`, isPng, isCorporate);
  };

  router.get("/brand", handleBrandOg);
  router.get("/brand.png", handleBrandOg);

  // ── Post OpenGraph Card ──
  const handlePostOg = (req: Request, res: Response): void => {
    const rawParam = getParam(req.params["id"]);
    const isPng = isPngTarget(rawParam, req);
    const rawId = rawParam.replace(/\.(svg|png)$/, "");
    if (!rawId || !/^[a-zA-Z0-9_-]+$/.test(rawId.trim())) {
      res.status(400).send("Invalid post ID");
      return;
    }
    const postId = rawId.trim();

    const { brandName, host, isCorporate } = getBaseContext(req);
    const rawPost = database.getPost(postId);
    const post =
      rawPost && (!rawPost.visibility || rawPost.visibility === "public" || rawPost.visibility === "unlisted")
        ? rawPost
        : undefined;

    if (!post) {
      res.status(404).send("Post not found");
      return;
    }

    let viewType: string | null = null;
    let viewConfig: string | Record<string, unknown> | null = null;
    let artifactTitle: string | null = null;
    if (post.artifact_view_id) {
      try {
        const art = database.getArtifactView(post.artifact_view_id);
        if (art?.view_type) viewType = art.view_type;
        if (typeof art?.view_config === "string" || (art?.view_config && typeof art.view_config === "object")) {
          viewConfig = art.view_config as string | Record<string, unknown>;
        }
        if (art?.title) artifactTitle = art.title;
      } catch {
        // ignore
      }
    }

    const svg = isTrainingRecipeViewType(viewType)
      ? renderTrainingRecipeOgSvg(
          {
            id: post.id,
            title: post.title || artifactTitle,
            content: post.content,
            username: post.username,
            display_name: post.display_name,
            view_type: viewType,
            view_config: viewConfig,
          },
          host,
          brandName,
        )
      : renderPostOgSvg(
          {
            id: post.id,
            title: post.title,
            content: post.content,
            username: post.username,
            display_name: post.display_name,
            created_at: post.created_at,
            thumbnail_url: post.thumbnail_url,
            artifact_view_id: post.artifact_view_id,
            view_type: viewType,
            like_count: post.like_count,
            reply_count: post.reply_count,
          },
          host,
          brandName,
        );

    sendOgResponse(req, res, svg, `post:${postId}`, isPng, isCorporate);
  };

  router.get("/post/:id", handlePostOg);

  // ── Package OpenGraph Card ──
  const handlePackageOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawParam = getParam(req.params["name"]);
    const isPng = isPngTarget(rawParam, req);
    const name = rawParam.replace(/\.(svg|png)$/, "");
    if (!name) {
      res.status(400).send("Missing package name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${name}` : name;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const pkg = database.getPackage(fullPkgName);
    const versions = pkg ? database.getPackageVersions(pkg.id) : [];
    const latestVersion = versions.length > 0 ? versions[versions.length - 1] : undefined;
    const classCount = latestVersion ? database.getClassCount(fullPkgName, latestVersion.version) : 0;
    const downloadStats = database.getPackageStats(fullPkgName);

    const svg = renderPackageOgSvg(
      {
        name: fullPkgName,
        version: latestVersion?.version || "1.0.0",
        description: pkg?.description,
        license: pkg?.license || "AGPL-3.0-or-later",
        class_count: classCount,
        downloads_count: downloadStats.totalDownloads,
      },
      host,
      brandName,
    );

    sendOgResponse(req, res, svg, `package:${fullPkgName}`, isPng, isCorporate);
  };

  router.get("/package/:scope/:name", handlePackageOg);
  router.get("/package/:name", handlePackageOg);

  // ── Class Specification OpenGraph Card ──
  const handleClassOg = (req: Request, res: Response): void => {
    const scope = getParam(req.params["scope"]);
    const rawName = getParam(req.params["name"]);
    const version = getParam(req.params["version"]);
    const rawClassParam = getParam(req.params["className"]);
    const isPng = isPngTarget(rawClassParam, req);
    const className = rawClassParam.replace(/\.(svg|png)$/, "");

    if (!rawName || !version || !className) {
      res.status(400).send("Missing package name, version, or class name");
      return;
    }
    const fullPkgName = scope ? `${scope}/${rawName}` : rawName;
    const { brandName, host, isCorporate } = getBaseContext(req);

    const cls = database.getClass(fullPkgName, version, className);

    const svg = renderClassOgSvg(
      {
        className,
        classKind: cls?.classKind || "model",
        description: cls?.description,
        documentation: cls?.documentation,
        packageName: fullPkgName,
        packageVersion: version,
        extends: cls?.extends || [],
        components: cls?.components || [],
      },
      host,
      brandName,
    );

    sendOgResponse(req, res, svg, `class:${fullPkgName}:${version}:${className}`, isPng, isCorporate);
  };

  router.get("/class/:scope/:name/:version/:className", handleClassOg);
  router.get("/class/:name/:version/:className", handleClassOg);

  return router;
}
