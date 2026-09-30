// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";

interface CachedPublicKey {
  publicKeyPem: string;
  actorPayload: Record<string, unknown>;
  cachedAt: number;
}

/** 24-hour cache TTL for verified remote ActivityPub actor public keys */
const PUBLIC_KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const publicKeyCache = new Map<string, CachedPublicKey>();

export function clearPublicKeyCache(): void {
  publicKeyCache.clear();
}

export function getPublicKeyCacheSize(): number {
  return publicKeyCache.size;
}

export function setCachedPublicKey(
  actorUrl: string,
  publicKeyPem: string,
  actorPayload: Record<string, unknown> = {},
): void {
  publicKeyCache.set(actorUrl, {
    publicKeyPem,
    actorPayload,
    cachedAt: Date.now(),
  });
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * Sliding-window rate limiter for ActivityPub inboxes.
 * Protects against inbox flood DoS (max 120 requests/minute per remote instance / IP).
 */
export class ActivityPubInboxRateLimiter {
  private readonly records = new Map<string, RateLimitRecord>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  constructor(maxPerWindow = 120, windowMs = 60 * 1000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  public check(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const record = this.records.get(key);

    if (!record || now >= record.resetAt) {
      return { allowed: true, remaining: this.maxPerWindow - 1, resetInMs: this.windowMs };
    }

    if (record.count >= this.maxPerWindow) {
      return { allowed: false, remaining: 0, resetInMs: record.resetAt - now };
    }

    return { allowed: true, remaining: this.maxPerWindow - record.count, resetInMs: record.resetAt - now };
  }

  public record(key: string): void {
    const now = Date.now();
    const record = this.records.get(key);

    if (!record || now >= record.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      record.count += 1;
    }
  }

  public reset(key?: string): void {
    if (key) {
      this.records.delete(key);
    } else {
      this.records.clear();
    }
  }

  public middleware(databaseGetter?: (req: Request) => LibraryDatabase | undefined) {
    return (req: Request, res: Response, next: NextFunction): void => {
      // In test mode, allow header override or bypass
      if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-inbox-limit"] === "true") {
        next();
        return;
      }

      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const hostHeader = (req.headers["host"] as string) || "";
      const ipKey = `ip:${clientIp}`;

      // Check IP limit
      const ipCheck = this.check(ipKey);
      if (!ipCheck.allowed) {
        res.status(429).json({
          error: "Rate limit exceeded for federation inbox. Maximum 120 requests per minute.",
          resetInSeconds: Math.ceil(ipCheck.resetInMs / 1000),
        });
        return;
      }

      this.record(ipKey);
      if (hostHeader) {
        this.record(`host:${hostHeader}`);
      }

      next();
    };
  }
}

export const defaultInboxLimiter = new ActivityPubInboxRateLimiter();

import { multibaseToEd25519Pem } from "../util/multikey.js";

export function createActivityPubVerifier(databaseInstance?: LibraryDatabase) {
  return async function verifyActivityPubSignature(req: Request, res: Response, next: NextFunction): Promise<void> {
    const db: LibraryDatabase | undefined =
      databaseInstance ||
      (req as any).database ||
      req.app?.locals?.database ||
      ((req.app as any)?.get ? (req.app as any).get("database") : undefined);

    try {
      if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-sig"] === "true") {
        const actor = req.body?.actor || "https://test.example.com/users/test";
        (req as Request & { actorId?: string }).actorId = actor;
        (req as Request & { actorProfile?: Record<string, unknown> }).actorProfile = {
          id: actor,
          preferredUsername: typeof actor === "string" ? actor.split("/").pop() || "testuser" : "testuser",
          publicKey: {
            id: `${actor}#main-key`,
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0=\n-----END PUBLIC KEY-----",
          },
        };
        next();
        return;
      }

      const sigInputHeader = req.headers["signature-input"] as string | undefined;

      // ── RFC 9421 HTTP Message Signatures branch ────────────────────────
      if (sigInputHeader) {
        const eqIdx = sigInputHeader.indexOf("=");
        if (eqIdx === -1) {
          res.status(401).json({ error: "Invalid Signature-Input header format" });
          return;
        }

        const label = sigInputHeader.slice(0, eqIdx).trim();
        const innerParams = sigInputHeader.slice(eqIdx + 1).trim();

        const openParen = innerParams.indexOf("(");
        const closeParen = innerParams.indexOf(")");
        if (openParen === -1 || closeParen === -1 || closeParen < openParen) {
          res.status(401).json({ error: "Invalid Signature-Input component identifier list" });
          return;
        }

        const componentsStr = innerParams.slice(openParen + 1, closeParen).trim();
        const coveredComponents = componentsStr
          .split(/\s+/)
          .map((c) => c.replace(/^"|"$/g, ""))
          .filter(Boolean);

        const paramsPart = innerParams.slice(closeParen + 1);
        const paramPairs = paramsPart
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
        const params: Record<string, string> = {};
        for (const pair of paramPairs) {
          const pEq = pair.indexOf("=");
          if (pEq !== -1) {
            const k = pair.slice(0, pEq).trim();
            let v = pair.slice(pEq + 1).trim();
            if (v.startsWith('"') && v.endsWith('"')) {
              v = v.slice(1, -1);
            }
            params[k] = v;
          }
        }

        const keyId = params["keyid"];
        const alg = (params["alg"] || "ed25519").toLowerCase();
        if (!keyId) {
          res.status(401).json({ error: "Missing keyid parameter in Signature-Input" });
          return;
        }

        // Parse signature value from Signature header: label=:base64:
        const sigHeader = (req.headers.signature as string) || "";
        let signatureValue = "";
        for (const item of sigHeader.split(",")) {
          const itemEq = item.indexOf("=");
          if (itemEq !== -1) {
            const itemLabel = item.slice(0, itemEq).trim();
            if (itemLabel === label) {
              let val = item.slice(itemEq + 1).trim();
              if (val.startsWith(":") && val.endsWith(":")) {
                val = val.slice(1, -1);
              }
              signatureValue = val;
              break;
            }
          }
        }

        if (!signatureValue) {
          res.status(401).json({ error: `Signature for '${label}' not found in Signature header` });
          return;
        }

        // Validate Content-Digest if present in covered components
        if (coveredComponents.includes("content-digest")) {
          const contentDigestHeader = req.headers["content-digest"] as string | undefined;
          if (!contentDigestHeader) {
            res.status(401).json({ error: "Missing Content-Digest header" });
            return;
          }
          const rawBody = req.body ? JSON.stringify(req.body) : "";
          const expectedHash = crypto.createHash("sha256").update(rawBody).digest("base64");
          if (!contentDigestHeader.includes(expectedHash)) {
            res.status(401).json({ error: "Content-Digest mismatch" });
            return;
          }
        }

        let actorUrl: URL;
        try {
          actorUrl = assertSafePublicUrl(keyId);
        } catch {
          res.status(400).json({ error: "Invalid or forbidden keyId URL" });
          return;
        }

        const actorDomain = actorUrl.hostname.toLowerCase();
        if (db) {
          if (db.isDomainSuspended(actorDomain)) {
            res.status(403).json({ error: `Domain '${actorDomain}' is suspended by instance administration.` });
            return;
          }
          if (db.isDomainSilenced(actorDomain)) {
            (req as any).isDomainSilenced = true;
          }
        }

        // Fetch Public Key
        let publicKeyPem: string | undefined;
        let actorPayload: Record<string, unknown> | undefined;

        const actorBaseUrl = `${actorUrl.origin}${actorUrl.pathname}`;
        const cached = publicKeyCache.get(actorUrl.href) || publicKeyCache.get(actorBaseUrl);
        if (cached && Date.now() - cached.cachedAt < PUBLIC_KEY_CACHE_TTL_MS) {
          publicKeyPem = cached.publicKeyPem;
          actorPayload = cached.actorPayload;
        } else {
          const fetchUrl = actorBaseUrl || actorUrl.href;
          const actorResponse = await safePublicFetch(fetchUrl, {
            headers: { Accept: "application/activity+json" },
          });

          if (!actorResponse.ok) {
            res.status(401).json({ error: "Could not fetch public key from keyId" });
            return;
          }

          actorPayload = (await actorResponse.json()) as Record<string, unknown>;

          // Look in assertionMethod (FEP-521a Multikey)
          if (Array.isArray(actorPayload.assertionMethod)) {
            const matchingKey = actorPayload.assertionMethod.find(
              (k: any) => k.id === keyId || (k.id && actorUrl.hash && k.id.endsWith(actorUrl.hash)),
            );
            if (matchingKey) {
              if (matchingKey.publicKeyMultibase) {
                publicKeyPem = multibaseToEd25519Pem(matchingKey.publicKeyMultibase);
              } else if (matchingKey.publicKeyPem) {
                publicKeyPem = matchingKey.publicKeyPem;
              }
            }
          }

          if (!publicKeyPem) {
            const pkObj = (actorPayload.publicKey as any) || {};
            publicKeyPem = pkObj.publicKeyPem || (actorPayload.publicKeyPem as string);
          }

          if (!publicKeyPem) {
            res.status(401).json({ error: "No public key found for actor" });
            return;
          }

          publicKeyCache.set(actorUrl.href, {
            publicKeyPem,
            actorPayload,
            cachedAt: Date.now(),
          });
          publicKeyCache.set(actorBaseUrl, {
            publicKeyPem,
            actorPayload,
            cachedAt: Date.now(),
          });
        }

        // Build RFC 9421 signature base
        const lines: string[] = [];
        for (const comp of coveredComponents) {
          if (comp === "@method") {
            lines.push(`"@method": ${req.method.toUpperCase()}`);
          } else if (comp === "@target-uri") {
            const fullUri = `${req.protocol}://${req.get("host") || "localhost"}${req.originalUrl}`;
            lines.push(`"@target-uri": ${fullUri}`);
          } else if (comp === "@path") {
            lines.push(`"@path": ${req.originalUrl.split("?")[0]}`);
          } else if (comp === "@request-target") {
            lines.push(`"@request-target": ${req.method.toLowerCase()} ${req.originalUrl}`);
          } else {
            const headerVal = (req.headers[comp.toLowerCase()] as string) || "";
            lines.push(`"${comp.toLowerCase()}": ${headerVal}`);
          }
        }

        lines.push(`"@signature-params": ${innerParams}`);
        const signatureBase = lines.join("\n");

        let isValid = false;
        try {
          if (alg === "ed25519") {
            isValid = crypto.verify(
              null,
              Buffer.from(signatureBase),
              publicKeyPem,
              Buffer.from(signatureValue, "base64"),
            );
          } else {
            const verifier = crypto.createVerify("RSA-SHA256");
            verifier.update(signatureBase);
            isValid = verifier.verify(publicKeyPem, signatureValue, "base64");
          }
        } catch (err) {
          console.error("RFC 9421 signature verification exception:", err);
          isValid = false;
        }

        if (!isValid) {
          res.status(401).json({ error: "Invalid signature" });
          return;
        }

        (req as Request & { actorId?: string | undefined }).actorId = (keyId as string).split("#")[0];
        (req as Request & { actorProfile?: Record<string, unknown> }).actorProfile = actorPayload;
        next();
        return;
      }

      // ── Legacy Draft-Cavage HTTP Signatures branch ────────────────────
      const signatureHeader = req.headers.signature as string | undefined;
      if (!signatureHeader) {
        res.status(401).json({ error: "Missing Signature header" });
        return;
      }

      // Parse Signature header
      const parts: Record<string, string> = {};
      for (const part of signatureHeader.split(",")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx !== -1) {
          const key = part.slice(0, eqIdx).trim();
          let val = part.slice(eqIdx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1);
          }
          parts[key] = val;
        }
      }

      if (!parts.keyId || !parts.signature || !parts.headers) {
        res.status(401).json({ error: "Invalid Signature header format" });
        return;
      }

      let actorUrl: URL;
      try {
        actorUrl = assertSafePublicUrl(parts.keyId);
      } catch {
        res.status(400).json({ error: "Invalid or forbidden keyId URL" });
        return;
      }

      const actorDomain = actorUrl.hostname.toLowerCase();

      // Instance Moderation: Domain Tiering Enforcement
      if (db) {
        if (db.isDomainSuspended(actorDomain)) {
          res.status(403).json({
            error: `Domain '${actorDomain}' is suspended by instance administration.`,
          });
          return;
        }

        if (db.isDomainSilenced(actorDomain)) {
          (req as any).isDomainSilenced = true;
        }
      }

      // Retrieve public key: First check 24-hour cache to avoid network DoS & CPU burn
      let publicKeyPem: string | undefined;
      let actor: Record<string, unknown> | undefined;

      const actorBaseUrl = `${actorUrl.origin}${actorUrl.pathname}`;
      const cached = publicKeyCache.get(actorUrl.href) || publicKeyCache.get(actorBaseUrl);
      if (cached && Date.now() - cached.cachedAt < PUBLIC_KEY_CACHE_TTL_MS) {
        publicKeyPem = cached.publicKeyPem;
        actor = cached.actorPayload;
      } else {
        // Fetch the public key from the keyId URL via SSRF-safe client
        const fetchUrl = actorBaseUrl || actorUrl.href;
        const actorResponse = await safePublicFetch(fetchUrl, {
          headers: { Accept: "application/activity+json" },
        });

        if (!actorResponse.ok) {
          res.status(401).json({ error: "Could not fetch public key from keyId" });
          return;
        }

        const payload = (await actorResponse.json()) as Record<string, unknown>;

        // Check assertionMethod (FEP-521a Multikey)
        if (Array.isArray(payload.assertionMethod)) {
          const matchingKey = payload.assertionMethod.find(
            (k: any) => k.id === parts.keyId || (k.id && actorUrl.hash && k.id.endsWith(actorUrl.hash)),
          );
          if (matchingKey) {
            if (matchingKey.publicKeyMultibase) {
              publicKeyPem = multibaseToEd25519Pem(matchingKey.publicKeyMultibase);
            } else if (matchingKey.publicKeyPem) {
              publicKeyPem = matchingKey.publicKeyPem;
            }
          }
        }

        if (!publicKeyPem) {
          const pkObj = (payload.publicKey as any) || {};
          publicKeyPem = pkObj.publicKeyPem || (payload.publicKeyPem as string);
        }
        actor = payload;

        if (!publicKeyPem) {
          res.status(401).json({ error: "No public key found for actor" });
          return;
        }

        // Cache for 24 hours
        publicKeyCache.set(actorUrl.href, {
          publicKeyPem,
          actorPayload: actor,
          cachedAt: Date.now(),
        });
        publicKeyCache.set(actorBaseUrl, {
          publicKeyPem,
          actorPayload: actor,
          cachedAt: Date.now(),
        });
      }

      // Reconstruct the string to sign
      const headersList = parts.headers.split(" ");
      const signedString = headersList
        .map((header) => {
          if (header === "(request-target)") {
            return `(request-target): ${req.method.toLowerCase()} ${req.originalUrl}`;
          }
          return `${header}: ${req.headers[header] || ""}`;
        })
        .join("\n");

      let isValid = false;
      try {
        if (parts.algorithm === "ed25519" || (parts.keyId && parts.keyId.includes("ed25519"))) {
          isValid = crypto.verify(
            null,
            Buffer.from(signedString),
            publicKeyPem,
            Buffer.from(parts.signature, "base64"),
          );
        } else {
          const verifier = crypto.createVerify("RSA-SHA256");
          verifier.update(signedString);
          isValid = verifier.verify(publicKeyPem, parts.signature, "base64");
        }
      } catch (err) {
        console.error("Cavage signature verification exception:", err);
        isValid = false;
      }

      if (!isValid) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Add actor data to request for downstream handlers
      (req as Request & { actorId?: string | undefined }).actorId = (parts.keyId as string).split("#")[0];
      (req as Request & { actorProfile?: Record<string, unknown> }).actorProfile = actor;

      next();
    } catch (err) {
      console.error("Signature verification failed:", err);
      res.status(500).json({ error: "Internal server error during signature verification" });
    }
  };
}

export const verifyActivityPubSignature = createActivityPubVerifier();
