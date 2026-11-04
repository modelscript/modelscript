// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resolve the text source of an artifact view (as returned by `getArtifactView`).
 * Used by wizard previews and by viewers that follow companion references.
 */

const INLINE_KEYS = ["stepCode", "stepSource", "code", "source", "content"] as const;

function parseViewConfig(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return {};
}

export async function extractArtifactSourceText(view: unknown): Promise<string | undefined> {
  if (!view || typeof view !== "object") return undefined;
  const cfg = parseViewConfig((view as { view_config?: unknown }).view_config);
  for (const key of INLINE_KEYS) {
    const value = cfg[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  const url = cfg["url"];
  if (typeof url === "string" && url.length > 0) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        return text.trim().length > 0 ? text : undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Title of an artifact view response, if present. */
export function artifactViewTitle(view: unknown): string | undefined {
  const title = view && typeof view === "object" ? (view as { title?: unknown }).title : undefined;
  return typeof title === "string" && title.length > 0 ? title : undefined;
}
