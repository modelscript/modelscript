// SPDX-License-Identifier: AGPL-3.0-or-later

import pako from "pako";
import parseDataUrl from "parse-data-url";

export interface CompressedMorselPayload {
  v: number;
  lang?: "modelica" | "sysml2" | "owl2" | "step";
  code: string;
  title?: string;
  view?: "split-columns" | "split-rows" | "code-only" | "diagram-only";
  params?: Record<string, number>;
  sim?: {
    stopTime?: number;
    stepSize?: number;
    tolerance?: number;
  };
}

/**
 * Compresses a Morsel payload into a URL-safe Base64 string.
 */
export function compressMorselPayload(payload: CompressedMorselPayload): string {
  const jsonStr = JSON.stringify(payload);
  const compressed = pako.deflate(jsonStr);
  let binary = "";
  const len = compressed.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
      if (parsed && typeof parsed.code === "string") {
        return parsed as CompressedMorselPayload;
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
          code: dataUrl.data,
        };
      }
    } catch (err) {
      console.warn("Failed to parse data URL:", err);
    }
  }

  return null;
}
