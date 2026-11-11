// SPDX-License-Identifier: AGPL-3.0-or-later

import pako from "pako";
import parseDataUrl from "parse-data-url";

export interface CompressedMorselPayload {
  v?: number | undefined;
  lang?: string | undefined;
  dialect?: string | undefined;
  code: string;
  files?: Record<string, string> | undefined;
  activeFile?: string | undefined;
  title?: string | undefined;
  view?: string | undefined;
  anchor?:
    | {
        elementId?: string | undefined;
        kind?: string | undefined;
        line?: number | undefined;
        column?: number | undefined;
      }
    | undefined;
  params?: Record<string, number> | undefined;
  sim?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        stepSize?: number | undefined;
        tolerance?: number | undefined;
        variables?: string[] | undefined;
      }
    | undefined;
  camera?:
    | {
        position?: [number, number, number] | undefined;
        target?: [number, number, number] | undefined;
      }
    | undefined;
  isMultiFile?: boolean | undefined;
  artifactId?: string | number | undefined;
  diagramType?: string | undefined;
  dependencies?: Array<{ name: string; version: string; [key: string]: unknown }> | undefined;
}

/**
 * Resolves a server-side short-link morsel ID (?morsel=<id>) from /api/v1/morsels/:id.
 */
export async function resolveMorselShortlink(
  morselId: string,
  options?: { fallbackDialect?: string | null; fallbackTitle?: string | null; fallbackView?: string | null },
): Promise<CompressedMorselPayload | null> {
  if (!morselId) return null;
  try {
    const res = await fetch(`/api/v1/morsels/${encodeURIComponent(morselId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const filesMap =
      data?.files && typeof data.files === "object" && !Array.isArray(data.files)
        ? (data.files as Record<string, string>)
        : data?.payload?.files && typeof data.payload.files === "object" && !Array.isArray(data.payload.files)
          ? (data.payload.files as Record<string, string>)
          : undefined;
    const firstFileCode = filesMap ? Object.values(filesMap)[0] : undefined;
    const code = typeof data?.code === "string" ? data.code : typeof firstFileCode === "string" ? firstFileCode : "";
    if (!code) return null;
    const detectedLang = data.dialect || data?.payload?.lang || options?.fallbackDialect || "modelica";
    const resolvedTitle = data.title || data?.payload?.title || options?.fallbackTitle || "Shared Engineering Model";
    return {
      ...(data.payload || {}),
      v: 1,
      lang: detectedLang,
      dialect: detectedLang,
      code,
      ...(filesMap ? { files: filesMap, isMultiFile: Object.keys(filesMap).length > 1 } : {}),
      title: resolvedTitle,
      view: data.view || data?.payload?.view || options?.fallbackView || "diagram",
    };
  } catch {
    return null;
  }
}

/**
 * Compresses a Morsel payload into a URL-safe Base64 string.
 */
export function compressMorselPayload(payload: CompressedMorselPayload): string {
  const normalized: CompressedMorselPayload = {
    v: payload.v ?? 1,
    ...payload,
    lang: payload.lang ?? payload.dialect ?? "modelica",
  };
  const jsonStr = JSON.stringify(normalized);
  const compressed = pako.deflate(jsonStr);
  let binary = "";
  const len = compressed.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(compressed[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const encodeMorselPermalink = compressMorselPayload;

/**
 * Decompresses a URL-safe Base64 string into a Morsel payload.
 * Also handles backward compatibility with raw #modelica= and #data: URLs.
 */
export function decompressMorselPayload(rawHash: string): CompressedMorselPayload | null {
  if (!rawHash) return null;
  const cleaned = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;

  // 1. Check for modern compressed payload prefix #m=...
  if (cleaned.startsWith("m=")) {
    try {
      const token = cleaned.slice(2);
      let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) {
        base64 += "=";
      }
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const decompressed = pako.inflate(bytes, { to: "string" });
      const parsed = JSON.parse(decompressed);
      if (parsed && typeof parsed === "object") {
        const filesMap =
          parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)
            ? (parsed.files as Record<string, string>)
            : undefined;
        const activeFile =
          typeof parsed.activeFile === "string" && filesMap && parsed.activeFile in filesMap
            ? parsed.activeFile
            : filesMap
              ? Object.keys(filesMap)[0]
              : undefined;
        const resolvedCode =
          typeof parsed.code === "string" ? parsed.code : activeFile && filesMap ? filesMap[activeFile] : undefined;
        if (typeof resolvedCode === "string") {
          const resolvedDialect = parsed.dialect ?? parsed.lang ?? "modelica";
          return {
            ...parsed,
            code: resolvedCode,
            ...(filesMap ? { files: filesMap } : {}),
            ...(activeFile ? { activeFile } : {}),
            lang: parsed.lang ?? resolvedDialect,
            dialect: resolvedDialect,
          } as CompressedMorselPayload;
        }
      }
    } catch (err) {
      console.warn("Failed to decompress Morsel payload:", err);
    }
  }

  // 2. Backward compatibility with legacy #modelica=...
  if (cleaned.startsWith("modelica=")) {
    try {
      const code = decodeURIComponent(cleaned.slice(9));
      return {
        v: 1,
        lang: "modelica",
        dialect: "modelica",
        code,
      };
    } catch (err) {
      console.warn("Failed to decode legacy #modelica URL:", err);
    }
  }

  // 3. Backward compatibility with parseDataUrl
  if (cleaned.startsWith("data:")) {
    try {
      const dataUrl = parseDataUrl(cleaned);
      if (dataUrl && dataUrl.data) {
        return {
          v: 1,
          lang: "modelica",
          dialect: "modelica",
          code: dataUrl.data,
        };
      }
    } catch (err) {
      console.warn("Failed to parse data URL:", err);
    }
  }

  // 4. Support #<dialect>=<encoded> for any supported dialect
  const dialectMatch = /^([a-z0-9_-]+)=([\s\S]+)$/i.exec(cleaned);
  if (dialectMatch && dialectMatch[1] && dialectMatch[1].toLowerCase() !== "m") {
    try {
      const dialect = dialectMatch[1].toLowerCase();
      const code = decodeURIComponent(dialectMatch[2]!);
      return {
        v: 1,
        lang: dialect,
        dialect,
        code,
      };
    } catch (err) {
      console.warn("Failed to decode #%s URL:", dialectMatch[1], err);
    }
  }

  return null;
}
