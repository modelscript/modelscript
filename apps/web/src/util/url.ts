// SPDX-License-Identifier: AGPL-3.0-or-later

const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Validates and normalizes a URL for safe use in `<a href>` or `<iframe src>`,
 * blocking `javascript:`, `data:`, `vbscript:`, and other dangerous URI schemes.
 */
export function sanitizeHttpUrl(
  rawUrl: string | null | undefined,
  options?: { allowRelative?: boolean | undefined; prependHttpsIfMissingScheme?: boolean | undefined },
): string | undefined {
  if (!rawUrl || typeof rawUrl !== "string") return undefined;
  // Strip ASCII control characters and leading/trailing whitespace
  // eslint-disable-next-line no-control-regex
  const trimmed = rawUrl.replace(/[\u0000-\u001F\u007F]+/g, "").trim();
  if (!trimmed) return undefined;

  const allowRelative = options?.allowRelative ?? true;
  if (allowRelative && (trimmed.startsWith("/") || trimmed.startsWith("#")) && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (SCHEME_REGEX.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  if (options?.prependHttpsIfMissingScheme) {
    try {
      const parsed = new URL(`https://${trimmed}`);
      if (parsed.protocol === "https:" && parsed.hostname.includes(".")) {
        return parsed.href;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Safely extracts the hostname from a URL string without throwing on relative or malformed URLs.
 */
export function safeHostname(rawUrl: string | null | undefined, fallback = "ansatz.social"): string {
  if (!rawUrl || typeof rawUrl !== "string") return fallback;
  try {
    const parsed = new URL(rawUrl, `https://${fallback}`);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname || fallback;
    }
  } catch {
    // ignore malformed URL
  }
  return fallback;
}

/**
 * Safely formats a URL for CSS `background-image: url("...")`, preventing CSS injection.
 */
export function safeCssImageUrl(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl || typeof rawUrl !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const trimmed = rawUrl.replace(/[\u0000-\u001F\u007F]+/g, "").trim();
  if (!trimmed) return undefined;

  const isDataImage = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed);
  const safeUrl = isDataImage ? trimmed : sanitizeHttpUrl(trimmed, { allowRelative: true });
  if (!safeUrl) return undefined;

  const escaped = safeUrl.replace(/["\\()\n\r]/g, (ch) => `\\${ch}`);
  return `url("${escaped}")`;
}

/**
 * Normalizes React Router route params for both unscoped (`/packages/:name/...`)
 * and scoped (`/packages/:scope/:name/...`) package routes.
 */
export function resolvePackageParams(params: {
  scope?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  className?: string | undefined;
  first?: string | undefined;
  second?: string | undefined;
}): {
  name: string | undefined;
  version: string | undefined;
  className: string | undefined;
} {
  let scope = params.scope;
  let name = params.name;
  let version = params.version;

  if (params.first !== undefined && params.second !== undefined) {
    if (params.first.startsWith("@")) {
      scope = params.first;
      name = params.second;
    } else {
      name = params.first;
      version = params.second;
    }
  }

  const rawScope = scope ? decodeURIComponent(scope) : undefined;
  const rawName = name ? decodeURIComponent(name) : undefined;
  const fullName = rawScope && rawName ? `${rawScope}/${rawName}` : rawName;
  return {
    name: fullName,
    version: version ? decodeURIComponent(version) : undefined,
    className: params.className ? decodeURIComponent(params.className) : undefined,
  };
}

/**
 * Safely encodes a package name for API and router path segments.
 * Preserves the `@scope/name` slash structure for scoped packages while encoding
 * individual path segments.
 */
export function encodePackagePath(name: string): string {
  if (!name) return "";
  if (name.startsWith("@") && name.includes("/")) {
    const [scope, ...rest] = name.split("/");
    return `${encodeURIComponent(scope!)}/${encodeURIComponent(rest.join("/"))}`;
  }
  return encodeURIComponent(name);
}
