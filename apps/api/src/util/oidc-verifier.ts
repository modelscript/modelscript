// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { safePublicFetch } from "./ssrf.js";

export interface OidcAttestation {
  issuer: string;
  subject: string;
  repository: string;
  repositoryOwner?: string | undefined;
  ref?: string | undefined;
  sha?: string | undefined;
  workflow?: string | undefined;
  workflowRef?: string | undefined;
  runId?: string | undefined;
  runAttempt?: string | undefined;
  actor?: string | undefined;
  provider: "github" | "gitlab" | "circleci" | "test" | "generic";
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  rawClaims: Record<string, unknown>;
}

export interface OidcVerificationResult {
  valid: boolean;
  attestation?: OidcAttestation | undefined;
  error?: string | undefined;
}

export interface OidcVerifyOptions {
  expectedAudience?: string | string[] | undefined;
  allowedIssuers?: string[] | undefined;
  allowUnsignedInTest?: boolean | undefined;
}

const PROD_ALLOWED_ISSUERS = [
  "https://token.actions.githubusercontent.com",
  "https://gitlab.com",
  "https://oidc.circleci.com",
];

const TEST_ONLY_ISSUERS = ["test-oidc-issuer", "https://oidc.test.modelscript.io"];

function getDefaultAllowedIssuers(): string[] {
  return process.env["NODE_ENV"] === "test" ? [...PROD_ALLOWED_ISSUERS, ...TEST_ONLY_ISSUERS] : PROD_ALLOWED_ISSUERS;
}

// In-memory test key registry for deterministic offline unit/integration testing
const testPublicKeyRegistry = new Map<string, crypto.KeyObject | string>();

export function registerTestOidcKey(kidOrIssuer: string, key: crypto.KeyObject | string): void {
  testPublicKeyRegistry.set(kidOrIssuer, key);
}

export function clearTestOidcKeys(): void {
  testPublicKeyRegistry.clear();
}

/**
 * Creates a signed mock OIDC token for testing without live CI network dependencies.
 */
export function createTestOidcToken(
  claims: Partial<OidcAttestation> & Record<string, unknown>,
  options?: {
    privateKey?: crypto.KeyObject | string | undefined;
    kid?: string | undefined;
    expired?: boolean | undefined;
  },
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = options?.expired ? now - 3600 : now + 3600;
  const iat = now - 60;

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: options?.kid || "test-key-1",
  };

  const payload: Record<string, unknown> = {
    iss: claims.issuer || "https://token.actions.githubusercontent.com",
    sub: claims.subject || `repo:${claims.repository || "org/repo"}:ref:refs/heads/main`,
    aud: "modelscript-registry",
    exp,
    nbf: iat,
    iat,
    repository: claims.repository || "modelscript-org/stdlib",
    repository_owner:
      claims.repositoryOwner || (claims.repository ? claims.repository.split("/")[0] : "modelscript-org"),
    ref: claims.ref || "refs/tags/v1.0.0",
    sha: claims.sha || "e4d909c290d0fb1ca068ffaddf22cbd0adddefec",
    workflow: claims.workflow || "Release Package",
    workflow_ref:
      claims.workflowRef ||
      `${claims.repository || "modelscript-org/stdlib"}/.github/workflows/release.yml@refs/tags/v1.0.0`,
    run_id: claims.runId || "1098765432",
    actor: claims.actor || "ci-bot",
    ...claims,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;

  let signatureB64 = "";
  if (options?.privateKey) {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signatureB64 = signer.sign(options.privateKey).toString("base64url");
  } else {
    // Deterministic HMAC fallback signature for test mode
    const hmac = crypto.createHmac("sha256", "test-secret-signing-key").update(signingInput).digest("base64url");
    signatureB64 = hmac;
  }

  return `${signingInput}.${signatureB64}`;
}

// Bounded in-memory cache for remote JWKS sets
interface JwksCacheEntry {
  keys: Array<{ kid?: string; kty: string; [key: string]: unknown }>;
  cachedAt: number;
}
const jwksCache = new Map<string, JwksCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const JWKS_MAX_ENTRIES = 100;

function isTrustedGitLabHost(hostname: string): boolean {
  return hostname === "gitlab.com" || hostname.endsWith(".gitlab.com");
}

function isTrustedGitHubHost(hostname: string): boolean {
  return hostname === "token.actions.githubusercontent.com";
}

/**
 * Fetches and caches JWKS from an OIDC provider using SSRF-safe public fetch.
 */
async function fetchJwks(issuerUrl: string): Promise<JwksCacheEntry["keys"]> {
  const cached = jwksCache.get(issuerUrl);
  if (cached && Date.now() - cached.cachedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const parsed = new URL(issuerUrl);
  if (parsed.protocol !== "https:") {
    throw new Error(`OIDC issuer '${issuerUrl}' must use HTTPS`);
  }

  const normalizedIssuer = issuerUrl.replace(/\/+$/, "");
  const isGitLab = isTrustedGitLabHost(parsed.hostname);
  const jwksUrl = isGitLab ? `${normalizedIssuer}/-/jwks` : `${normalizedIssuer}/.well-known/jwks.json`;

  const res = await safePublicFetch(jwksUrl, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${res.statusText}`);
  }

  const json = (await res.json()) as { keys?: Array<{ kid?: string; kty: string; [key: string]: unknown }> };
  const keys = json.keys || [];
  if (jwksCache.size >= JWKS_MAX_ENTRIES) {
    const oldestKey = jwksCache.keys().next().value;
    if (oldestKey) jwksCache.delete(oldestKey);
  }
  jwksCache.set(issuerUrl, { keys, cachedAt: Date.now() });
  return keys;
}

/**
 * Parses and verifies an OpenID Connect (OIDC) ID token from a CI/CD runner.
 */
export async function verifyOidcToken(token: string, options?: OidcVerifyOptions): Promise<OidcVerificationResult> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Empty or invalid OIDC token supplied" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed OIDC token: expected JWT 3-part structure" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(Buffer.from(headerB64!, "base64url").toString("utf-8"));
    payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf-8"));
  } catch (err) {
    return {
      valid: false,
      error: `Failed to decode OIDC token JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 1. Validate Expiration & Timestamps
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload["exp"] === "number" && payload["exp"] < now) {
    return { valid: false, error: `OIDC token has expired (exp: ${payload["exp"]}, now: ${now})` };
  }
  if (typeof payload["nbf"] === "number" && payload["nbf"] > now + 60) {
    return { valid: false, error: `OIDC token not yet valid (nbf: ${payload["nbf"]}, now: ${now})` };
  }

  // 2. Validate Issuer
  const issuer = typeof payload["iss"] === "string" ? payload["iss"] : "";
  if (!issuer) {
    return { valid: false, error: "OIDC token missing 'iss' claim" };
  }

  const isTestEnv = process.env["NODE_ENV"] === "test";
  const isProdEnv = process.env["NODE_ENV"] === "production";
  const allowedIssuers = options?.allowedIssuers ?? getDefaultAllowedIssuers();

  let parsedIssuerUrl: URL | null = null;
  try {
    parsedIssuerUrl = new URL(issuer);
  } catch {
    parsedIssuerUrl = null;
  }

  const isAllowedIssuer = allowedIssuers.some(
    (allowed) =>
      allowed === issuer ||
      (parsedIssuerUrl?.protocol === "https:" &&
        isTrustedGitLabHost(parsedIssuerUrl.hostname) &&
        allowed === "https://gitlab.com"),
  );

  if (!isAllowedIssuer && (isProdEnv || !isTestEnv)) {
    return { valid: false, error: `OIDC token issuer '${issuer}' is not in the trusted issuer registry` };
  }

  // 3. Validate Audience if specified
  if (options?.expectedAudience) {
    const expected = Array.isArray(options.expectedAudience) ? options.expectedAudience : [options.expectedAudience];
    const audClaim = payload["aud"];
    const actualAuds = Array.isArray(audClaim) ? audClaim : [String(audClaim || "")];
    const match = expected.some((e) => actualAuds.includes(e));
    if (!match) {
      return {
        valid: false,
        error: `OIDC token audience '${actualAuds.join(",")}' does not match expected audience '${expected.join(",")}'`,
      };
    }
  }

  // 4. Cryptographic Signature Verification
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureBytes = Buffer.from(signatureB64!, "base64url");
  const kid = header.kid;

  let signatureVerified = false;

  // Check in-memory registered test keys strictly in non-production environments
  if (!isProdEnv && kid && testPublicKeyRegistry.has(kid)) {
    const testKey = testPublicKeyRegistry.get(kid)!;
    try {
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(signingInput);
      signatureVerified = verifier.verify(testKey, signatureBytes);
    } catch {
      signatureVerified = false;
    }
  } else if (!isProdEnv && testPublicKeyRegistry.has(issuer)) {
    const testKey = testPublicKeyRegistry.get(issuer)!;
    try {
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(signingInput);
      signatureVerified = verifier.verify(testKey, signatureBytes);
    } catch {
      signatureVerified = false;
    }
  }

  // Deterministic HMAC fallback is strictly limited to NODE_ENV === 'test'
  if (!signatureVerified && isTestEnv) {
    const hmacExpected = crypto
      .createHmac("sha256", "test-secret-signing-key")
      .update(signingInput)
      .digest("base64url");
    if (
      hmacExpected.length === signatureB64!.length &&
      crypto.timingSafeEqual(Buffer.from(hmacExpected), Buffer.from(signatureB64!))
    ) {
      signatureVerified = true;
    }
  }

  // Attempt live JWKS fetch for trusted GitHub / GitLab / explicit HTTPS issuers
  const canFetchJwks =
    parsedIssuerUrl?.protocol === "https:" &&
    (isTrustedGitHubHost(parsedIssuerUrl.hostname) || isTrustedGitLabHost(parsedIssuerUrl.hostname) || isAllowedIssuer);

  if (!signatureVerified && canFetchJwks) {
    try {
      const jwks = await fetchJwks(issuer);
      const matchingKey = kid ? jwks.find((k) => k.kid === kid) : jwks[0];
      if (matchingKey) {
        const pubKey = crypto.createPublicKey({
          key: matchingKey as unknown as crypto.JsonWebKeyInput["key"],
          format: "jwk",
        });
        const verifier = crypto.createVerify("RSA-SHA256");
        verifier.update(signingInput);
        signatureVerified = verifier.verify(pubKey, signatureBytes);
      }
    } catch (jwksErr) {
      // Only allow offline fallback when explicitly running under NODE_ENV === 'test'
      if (isTestEnv && options?.allowUnsignedInTest) {
        signatureVerified = true;
      } else {
        return {
          valid: false,
          error: `OIDC signature verification failed: Unable to fetch or verify JWKS from ${issuer} (${jwksErr instanceof Error ? jwksErr.message : String(jwksErr)})`,
        };
      }
    }
  }

  if (!signatureVerified && !(isTestEnv && options?.allowUnsignedInTest)) {
    return { valid: false, error: "Cryptographic OIDC token signature verification failed (M3012)" };
  }

  // 5. Extract Standardized Attestation Metadata
  let provider: OidcAttestation["provider"] = "generic";
  if (issuer.includes("github")) provider = "github";
  else if (issuer.includes("gitlab")) provider = "gitlab";
  else if (issuer.includes("circleci")) provider = "circleci";
  else if (issuer.includes("test")) provider = "test";

  let repository = "";
  let repositoryOwner: string | undefined;
  let workflow: string | undefined;
  let workflowRef: string | undefined;
  let runId: string | undefined;
  let actor: string | undefined;
  let ref: string | undefined;
  let sha: string | undefined;

  if (provider === "github") {
    repository = String(payload["repository"] || "");
    repositoryOwner = String(payload["repository_owner"] || repository.split("/")[0] || "");
    workflow = String(payload["workflow"] || "");
    workflowRef = String(payload["workflow_ref"] || "");
    runId = String(payload["run_id"] || "");
    actor = String(payload["actor"] || "");
    ref = String(payload["ref"] || "");
    sha = String(payload["sha"] || "");
  } else if (provider === "gitlab") {
    repository = String(payload["project_path"] || "");
    repositoryOwner = repository.split("/")[0];
    workflowRef = String(payload["ci_config_ref_uri"] || "");
    runId = String(payload["pipeline_id"] || payload["job_id"] || "");
    actor = String(payload["user_login"] || payload["user_email"] || "");
    ref = String(payload["ref"] || "");
    sha = String(payload["commit_sha"] || payload["sha"] || "");
  } else {
    repository = String(payload["repository"] || payload["project"] || "unknown/repo");
    repositoryOwner = String(payload["repository_owner"] || repository.split("/")[0]);
    workflow = String(payload["workflow"] || "CI");
    workflowRef = String(payload["workflow_ref"] || "");
    runId = String(payload["run_id"] || "");
    actor = String(payload["actor"] || "ci");
    ref = String(payload["ref"] || "");
    sha = String(payload["sha"] || "");
  }

  const attestation: OidcAttestation = {
    issuer,
    subject: String(payload["sub"] || ""),
    repository,
    repositoryOwner,
    ref,
    sha,
    workflow,
    workflowRef,
    runId,
    actor,
    provider,
    issuedAt: typeof payload["iat"] === "number" ? new Date(payload["iat"] * 1000).toISOString() : undefined,
    expiresAt: typeof payload["exp"] === "number" ? new Date(payload["exp"] * 1000).toISOString() : undefined,
    rawClaims: payload,
  };

  return { valid: true, attestation };
}

/**
 * Validates that an authenticated OIDC attestation is authorized to publish the target package namespace.
 */
export function verifyOidcPackageAuthorization(
  attestation: OidcAttestation,
  packageName: string,
  database?: LibraryDatabase,
): { authorized: boolean; reason?: string } {
  const isScoped = packageName.startsWith("@");
  const scope = isScoped ? packageName.slice(1).split("/")[0]! : "";
  const baseName = isScoped ? packageName.slice(1).split("/")[1]! : packageName;

  const repo = attestation.repository.toLowerCase();
  const repoParts = repo.split("/");
  const repoOwner = (attestation.repositoryOwner || repoParts[0] || "").toLowerCase();
  const repoName = (repoParts[1] || "").toLowerCase();

  // 1. Database linked repo or registered owner/collaborator verification (authoritative)
  if (database) {
    const linked = database.getLinkedRepoById(attestation.repository);
    if (linked) {
      const allowed = database.canUserPublishPackage(packageName, linked.user_id);
      if (allowed.allowed) {
        return { authorized: true };
      }
    }

    // Check if user with repoOwner username is collaborator/owner
    const ownerUser = database.getUserByUsername(repoOwner);
    if (ownerUser) {
      const allowed = database.canUserPublishPackage(packageName, ownerUser.id);
      if (allowed.allowed) {
        return { authorized: true };
      }
    }
  }

  // 2. Scoped exact-namespace bootstrap: `@scope/name` matches `scope/name` repository only if
  // the package has not yet been registered in the database (existing packages require DB ACL check above)
  if (isScoped && repoOwner === scope.toLowerCase() && repoName === baseName.toLowerCase()) {
    const existingPkg = database?.getPackage(packageName);
    if (!existingPkg) {
      return { authorized: true };
    }
  }

  // 3. Test-only permissive fallback (strictly NODE_ENV === 'test')
  if (
    process.env["NODE_ENV"] === "test" &&
    (attestation.issuer.includes("test") || repo === "modelscript-org/stdlib")
  ) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: `CI/CD repository '${attestation.repository}' (owned by '${repoOwner}') is not authorized to publish package '${packageName}' (M4012)`,
  };
}
