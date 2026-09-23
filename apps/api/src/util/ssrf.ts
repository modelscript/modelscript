// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Validate that a URL is safe for server-side outbound requests.
 * Checks for valid HTTP/HTTPS protocol and rejects local, private, and metadata network targets.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    // Reject localhost and loopback
    if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") {
      return false;
    }
    // Reject private IP ranges, link-local, AWS metadata
    if (
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^0\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
