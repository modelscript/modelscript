// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Landing-page Polyglot Sandbox helpers:
 * Re-exports shared dialect detection & fault injection from `@modelscript/lsp/utils/polyglot-detector.js`
 * alongside the stateful Morsel handoff URL encoder (`#m=<deflated-base64url>`).
 */

export {
  UNIQUE_EXT_TO_SLUG,
  detectPolyglotLanguage,
  injectRealisticFault,
  type DetectedLanguageMatch,
} from "@modelscript/lsp/utils/polyglot-detector.js";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Compresses open sandbox tabs into a URL hash compatible with Morsel's
 * `decompressMorselPayload` (`#m=<deflated-base64url>`).
 */
export async function buildMorselHandoffUrl(
  ansatzOrigin: string,
  tabs: Array<{ fileName: string; langSlug: string; code: string }>,
  activeIndex: number,
): Promise<string> {
  const active = tabs[activeIndex] ?? tabs[0]!;
  const files: Record<string, string> = {};
  for (const t of tabs) {
    files[t.fileName] = t.code;
  }
  const payload = {
    v: 1,
    lang: active.langSlug,
    dialect: active.langSlug,
    code: active.code,
    files,
    activeFile: active.fileName,
    isMultiFile: tabs.length > 1,
  };
  const json = JSON.stringify(payload);
  try {
    if (typeof CompressionStream !== "undefined") {
      const encoded = new TextEncoder().encode(json);
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      await writer.write(encoded);
      await writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      const token = bytesToBase64Url(new Uint8Array(buf));
      return `${ansatzOrigin}/editor#m=${token}`;
    }
  } catch {
    // Fallback to raw dialect hash below
  }
  return `${ansatzOrigin}/editor#${encodeURIComponent(active.langSlug)}=${encodeURIComponent(active.code)}`;
}
