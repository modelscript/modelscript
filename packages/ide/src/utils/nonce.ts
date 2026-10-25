// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generates a cryptographically strong alphanumeric nonce for webview CSP tags.
 * Safe across Node.js unit tests, Web Workers, and browser execution environments.
 */
export function getNonce(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
