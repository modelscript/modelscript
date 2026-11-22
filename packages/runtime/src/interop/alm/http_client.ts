// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared HTTP client helper for ALM/RM protocol connectors.
 * Supports Bearer/Basic auth, OSLC configuration context headers, optimistic locking (`If-Match`),
 * and bounded exponential backoff on HTTP 429 / 503 responses.
 */

import type { AuthContext } from "./alm_ir.js";

export interface AlmHttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | unknown | undefined;
  auth?: AuthContext | undefined;
  maxRetries?: number | undefined;
}

export interface AlmHttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  json: () => T;
}

export function buildAuthHeaders(auth?: AuthContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!auth) return headers;

  if (auth.headers) {
    for (const [k, v] of Object.entries(auth.headers)) {
      headers[k] = v;
    }
  }

  if (auth.username && (auth.password || auth.token)) {
    const secret = auth.password ?? auth.token ?? "";
    const encoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(`${auth.username}:${secret}`, "utf-8").toString("base64")
        : btoa(`${auth.username}:${secret}`);
    headers["Authorization"] = `Basic ${encoded}`;
  } else if (auth.token) {
    headers["Authorization"] =
      auth.token.startsWith("Bearer ") || auth.token.startsWith("Basic ") ? auth.token : `Bearer ${auth.token}`;
  }

  return headers;
}

const oauthTokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

async function resolveOAuth2AccessToken(auth: AuthContext, fetchFn: typeof fetch): Promise<string | undefined> {
  if (!auth.oauth2) return auth.token;
  const { tokenUrl, clientId, clientSecret, refreshToken, scope } = auth.oauth2;
  const cacheKey = `${tokenUrl}|${clientId}|${scope ?? ""}`;
  const cached = oauthTokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 15_000) {
    return cached.accessToken;
  }

  const params = new URLSearchParams();
  if (refreshToken) {
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", refreshToken);
  } else {
    params.set("grant_type", "client_credentials");
  }
  params.set("client_id", clientId);
  if (clientSecret) params.set("client_secret", clientSecret);
  if (scope) params.set("scope", scope);

  const res = await fetchFn(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth2 token exchange failed (${res.status}) at ${tokenUrl}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error(`OAuth2 token response from ${tokenUrl} did not contain 'access_token'.`);
  }
  const ttlSec = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  oauthTokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + ttlSec * 1000,
  });
  return data.access_token;
}

export async function almFetch<T = unknown>(
  url: string,
  options: AlmHttpRequestOptions = {},
): Promise<AlmHttpResponse<T>> {
  const fetchFn = options.auth?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Global fetch() is not available in this runtime environment.");
  }

  let effectiveAuth = options.auth;
  if (options.auth?.oauth2 && !options.auth.token) {
    const token = await resolveOAuth2AccessToken(options.auth, fetchFn);
    effectiveAuth = { ...options.auth, token };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeaders(effectiveAuth),
    ...(options.headers ?? {}),
  };

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string") {
      bodyStr = options.body;
    } else {
      bodyStr = JSON.stringify(options.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const maxRetries = options.maxRetries ?? 2;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };
    if (bodyStr !== undefined) {
      init.body = bodyStr;
    }
    const response = await fetchFn(url, init);
    lastResponse = response;

    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 3000)));
      continue;
    }
    break;
  }

  const res = lastResponse!;
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text,
    json: () => JSON.parse(text) as T,
  };
}

/**
 * Extracts the `rel="next"` URL from an RFC 5988 HTTP `Link` header (GitHub, REST APIs).
 */
export function parseLinkHeaderNext(linkHeader: string | null | undefined): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel=["']?next["']?/i.exec(part.trim());
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/**
 * Acquires a PTC Windchill OData CSRF nonce (`GET /Windchill/servlet/odata/PTC/GetCSRFToken()`).
 * Returns `undefined` if the server does not require or expose a CSRF endpoint.
 */
export async function fetchWindchillCsrfNonce(
  origin: string,
  auth: AuthContext,
): Promise<{ key: string; value: string } | undefined> {
  try {
    const res = await almFetch<Record<string, unknown>>(`${origin}/Windchill/servlet/odata/PTC/GetCSRFToken()`, {
      auth,
    });
    if (!res.ok) return undefined;
    const data = res.json();
    const value = data["NonceValue"] ?? data["CSRF_NONCE"];
    const key = String(data["NonceKey"] ?? "CSRF_NONCE");
    if (typeof value === "string" && value.length > 0) {
      return { key, value };
    }
  } catch {
    // Graceful fallback when CSRF endpoint is absent
  }
  return undefined;
}

/**
 * Computes PTC Onshape HMAC-SHA256 authentication headers (`On-Nonce`, `Date`, `Authorization: On ...`).
 * Works in both Node.js (`node:crypto`) and browsers (`crypto.subtle`).
 */
export async function buildOnshapeHmacHeaders(
  method: string,
  fullUrl: string,
  accessKey: string,
  secretKey: string,
  contentType = "application/json",
): Promise<Record<string, string>> {
  const parsed = new URL(fullUrl);
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.slice(0, 25);
  const dateStr = new Date().toUTCString();
  const query = parsed.search ? parsed.search.slice(1) : "";
  const canonical =
    `${method.toUpperCase()}\n${nonce}\n${dateStr}\n${contentType}\n${parsed.pathname}\n${query}\n`.toLowerCase();

  let signatureBase64: string;
  if (globalThis.crypto?.subtle) {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      enc.encode(secretKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(canonical));
    signatureBase64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(sig).toString("base64")
        : btoa(String.fromCharCode(...new Uint8Array(sig)));
  } else {
    const cryptoMod = await import("node:crypto");
    signatureBase64 = cryptoMod.createHmac("sha256", secretKey).update(canonical).digest("base64");
  }

  return {
    "On-Nonce": nonce,
    Date: dateStr,
    Authorization: `On ${accessKey}:HmacSHA256:${signatureBase64}`,
  };
}

const xrayJwtCache = new Map<string, { token: string; expiresAtMs: number }>();

/**
 * Exchanges Xray Cloud `client_id` / `client_secret` for a short-lived Bearer JWT
 * via `POST /api/v2/authenticate`.
 */
export async function exchangeXrayCloudJwt(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  auth: AuthContext,
): Promise<string | undefined> {
  const cacheKey = `${baseUrl}|${clientId}`;
  const cached = xrayJwtCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 30_000) {
    return cached.token;
  }
  const res = await almFetch<string>(`${baseUrl.replace(/\/+$/, "")}/authenticate`, {
    method: "POST",
    auth: { fetchImpl: auth.fetchImpl },
    body: { client_id: clientId, client_secret: clientSecret },
  });
  if (!res.ok) return undefined;
  const raw = res.text.trim().replace(/^"|"$/g, "");
  if (!raw) return undefined;
  xrayJwtCache.set(cacheKey, { token: raw, expiresAtMs: Date.now() + 50 * 60_000 });
  return raw;
}
