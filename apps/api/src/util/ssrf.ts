// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Validates and asserts that a URL is safe for server-side outbound requests.
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets.
 * Returns the parsed and validated URL object.
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Forbidden protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^0\./.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`Forbidden host: ${hostname}`);
  }

  return parsed;
}

/**
 * Validate that a URL is safe for server-side outbound requests.
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    assertSafePublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
