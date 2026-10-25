// SPDX-License-Identifier: AGPL-3.0-or-later

import pako from "pako";
import type { UniversalEmbedPayload } from "./protocol.js";

/**
 * Compresses a UniversalEmbedPayload into a URL-safe Base64 permalink token.
 */
export function compressEmbedPayload(payload: UniversalEmbedPayload): string {
  const jsonStr = JSON.stringify(payload);
  const compressed = pako.deflate(jsonStr);
  let binary = "";
  const len = compressed.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(compressed[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decompresses a URL-safe Base64 string into a UniversalEmbedPayload.
 */
export function decompressEmbedPayload(rawHash: string): UniversalEmbedPayload | null {
  if (!rawHash) return null;
  const cleaned = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;

  const token = cleaned.startsWith("m=") ? cleaned.slice(2) : cleaned;
  try {
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
    if (parsed && typeof parsed.code === "string") {
      return parsed as UniversalEmbedPayload;
    }
  } catch (err) {
    console.warn("[modelscript/embed] Failed to decompress embed payload:", err);
  }

  return null;
}

/**
 * Generates the target launch URL based on whether the payload is single-file or multi-file.
 */
export function getLaunchUrl(
  payload: UniversalEmbedPayload,
  baseUrl: { playground?: string; ide?: string } = {},
): { target: "playground" | "ide"; url: string } {
  const playgroundBase = baseUrl.playground ?? "/playground";
  const ideBase = baseUrl.ide ?? "/vscode/workbench";

  if (payload.isMultiFile && payload.artifactId) {
    let ideUrl = `${ideBase}/#memfs:artifact-${payload.artifactId}`;
    if (payload.anchor?.elementId) {
      ideUrl += `&anchor=${encodeURIComponent(payload.anchor.elementId)}`;
    }
    return { target: "ide", url: ideUrl };
  }

  const token = compressEmbedPayload(payload);
  return { target: "playground", url: `${playgroundBase}#m=${token}` };
}
