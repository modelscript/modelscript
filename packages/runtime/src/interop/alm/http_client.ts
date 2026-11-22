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
