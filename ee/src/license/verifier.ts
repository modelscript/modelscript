// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import crypto from "node:crypto";
import fs from "node:fs";

export type EnterpriseTier = "appliance" | "commercial-sdk" | "cloud-enterprise";

export type EnterpriseFeature =
  | "airgap_compliance"
  | "saml_oidc_sso"
  | "slurm_hpc"
  | "digital_twins"
  | "sysml2_omg_api"
  | "mcp_sse_gateway"
  | "dhf_attestation"
  | "digital_thread_governance"
  | "hil_codegen"
  | "plm_connectors";

export const ALL_ENTERPRISE_FEATURES: readonly EnterpriseFeature[] = [
  "airgap_compliance",
  "saml_oidc_sso",
  "slurm_hpc",
  "digital_twins",
  "sysml2_omg_api",
  "mcp_sse_gateway",
  "dhf_attestation",
  "digital_thread_governance",
  "hil_codegen",
  "plm_connectors",
] as const;

export interface EnterpriseLicenseClaims {
  /** License token format version */
  v: 1;
  /** Unique license identifier */
  jti: string;
  /** Customer organization slug or ID */
  sub: string;
  /** Customer organization display name */
  org: string;
  /** Commercial tier */
  tier: EnterpriseTier;
  /** Maximum licensed seats (0 = unlimited site license) */
  seats: number;
  /** Enabled enterprise feature flags */
  features: EnterpriseFeature[];
  /** Issued-at Unix timestamp (seconds) */
  iat: number;
  /** Expiration Unix timestamp (seconds) */
  exp: number;
}

export interface LicenseVerificationResult {
  valid: boolean;
  mode: "licensed" | "dev-evaluation" | "unlicensed" | "expired" | "invalid";
  claims?: EnterpriseLicenseClaims | undefined;
  reason?: string | undefined;
}

export interface Ed25519KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Deterministic development/evaluation Ed25519 keypair derived from a fixed seed
 * so unit tests and offline evaluation environments can verify tokens deterministically
 * when no custom public key override is provided.
 */
const DEFAULT_DEV_SEED = crypto.createHash("sha256").update("modelscript-ee-ed25519-root-seed-v1").digest();

function createKeyPairFromSeed(seed32: Buffer): Ed25519KeyPairPem {
  // PKCS#8 Ed25519 prefix (RFC 8410) + 32-byte seed
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const pkcs8Der = Buffer.concat([pkcs8Prefix, seed32.subarray(0, 32)]);
  const privateKeyObj = crypto.createPrivateKey({
    key: pkcs8Der,
    format: "der",
    type: "pkcs8",
  });
  const publicKeyObj = crypto.createPublicKey(privateKeyObj);
  return {
    publicKeyPem: publicKeyObj.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKeyObj.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

const DEFAULT_KEYPAIR = createKeyPairFromSeed(DEFAULT_DEV_SEED);

/**
 * Production Ed25519 public key for verifying customer `msx_lic_...` tokens.
 * The corresponding private key is stored offline in `.keys/msx-license-private.pem` (gitignored).
 */
export const PRODUCTION_ENTERPRISE_PUBLIC_KEY_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAeCDZqQq9HX9y6PDvxW9d6DdJuqT+pzvo8Sz3d7mPrSc=",
  "-----END PUBLIC KEY-----",
  "",
].join("\n");

export const DEFAULT_ENTERPRISE_PUBLIC_KEY_PEM = PRODUCTION_ENTERPRISE_PUBLIC_KEY_PEM;

/**
 * Generates a fresh random Ed25519 keypair in PEM format for signing enterprise license tokens.
 */
export function generateLicenseKeyPair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

/**
 * Signs an EnterpriseLicenseClaims payload using an Ed25519 private key,
 * producing an offline-verifiable `msx_lic_<payloadB64Url>.<sigB64Url>` token.
 */
export function signEnterpriseLicense(
  claims: Omit<EnterpriseLicenseClaims, "v" | "jti" | "iat"> & {
    jti?: string | undefined;
    iat?: number | undefined;
  },
  privateKeyPem: string = DEFAULT_KEYPAIR.privateKeyPem,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullClaims: EnterpriseLicenseClaims = {
    v: 1,
    jti: claims.jti ?? `lic_${crypto.randomBytes(8).toString("hex")}`,
    sub: claims.sub,
    org: claims.org,
    tier: claims.tier,
    seats: claims.seats,
    features: [...claims.features],
    iat: claims.iat ?? nowSec,
    exp: claims.exp,
  };

  const payloadBytes = Buffer.from(JSON.stringify(fullClaims), "utf-8");
  const payloadB64 = payloadBytes.toString("base64url");
  const signatureBytes = crypto.sign(null, Buffer.from(payloadB64, "utf-8"), privateKeyPem);
  const sigB64 = signatureBytes.toString("base64url");

  return `msx_lic_${payloadB64}.${sigB64}`;
}

/**
 * Verifies an offline `msx_lic_<payload>.<sig>` token against an Ed25519 public key.
 * Zero network calls are performed, making this suitable for NERC CIP / FERC CEII air-gapped deployments.
 */
export function verifyEnterpriseLicense(
  token: string,
  options?: {
    publicKeyPem?: string | undefined;
    nowSeconds?: number | undefined;
  },
): LicenseVerificationResult {
  const trimmed = token.trim();
  if (!trimmed.startsWith("msx_lic_")) {
    return {
      valid: false,
      mode: "invalid",
      reason: "License token must start with 'msx_lic_'.",
    };
  }

  const body = trimmed.slice("msx_lic_".length);
  const dotIdx = body.indexOf(".");
  if (dotIdx <= 0 || dotIdx === body.length - 1 || body.indexOf(".", dotIdx + 1) !== -1) {
    return {
      valid: false,
      mode: "invalid",
      reason: "Malformed license token structure.",
    };
  }

  const payloadB64 = body.slice(0, dotIdx);
  const sigB64 = body.slice(dotIdx + 1);
  const explicitKey = options?.publicKeyPem || process.env["MSX_LICENSE_PUBLIC_KEY"];
  const candidatePublicKeys = explicitKey
    ? [explicitKey]
    : process.env["NODE_ENV"] === "production"
      ? [PRODUCTION_ENTERPRISE_PUBLIC_KEY_PEM]
      : [PRODUCTION_ENTERPRISE_PUBLIC_KEY_PEM, DEFAULT_KEYPAIR.publicKeyPem];

  try {
    const signatureBytes = Buffer.from(sigB64, "base64url");
    const payloadBuffer = Buffer.from(payloadB64, "utf-8");
    const isSigValid = candidatePublicKeys.some((pubKey) => crypto.verify(null, payloadBuffer, pubKey, signatureBytes));
    if (!isSigValid) {
      return {
        valid: false,
        mode: "invalid",
        reason: "Cryptographic Ed25519 signature verification failed.",
      };
    }

    const decodedJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const parsed = JSON.parse(decodedJson) as Partial<EnterpriseLicenseClaims>;

    if (
      parsed.v !== 1 ||
      typeof parsed.sub !== "string" ||
      typeof parsed.org !== "string" ||
      typeof parsed.tier !== "string" ||
      typeof parsed.seats !== "number" ||
      !Array.isArray(parsed.features) ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return {
        valid: false,
        mode: "invalid",
        reason: "License claims payload is missing required fields.",
      };
    }

    const claims: EnterpriseLicenseClaims = {
      v: 1,
      jti: typeof parsed.jti === "string" ? parsed.jti : "lic_unknown",
      sub: parsed.sub,
      org: parsed.org,
      tier: parsed.tier,
      seats: parsed.seats,
      features: parsed.features,
      iat: parsed.iat,
      exp: parsed.exp,
    };

    const nowSec = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (claims.exp <= nowSec) {
      return {
        valid: false,
        mode: "expired",
        claims,
        reason: `Enterprise license expired at ${new Date(claims.exp * 1000).toISOString()}.`,
      };
    }

    return {
      valid: true,
      mode: "licensed",
      claims,
    };
  } catch (err) {
    return {
      valid: false,
      mode: "invalid",
      reason: err instanceof Error ? err.message : "Failed to parse license token.",
    };
  }
}

let cachedLicenseCacheKey: string | null = null;
let cachedLicenseResult: LicenseVerificationResult | null = null;
let cachedLicenseAtMs = 0;
const LICENSE_CACHE_TTL_MS = 5_000;

/**
 * Resolves the active Enterprise License from `MSX_LICENSE_KEY` or `MSX_LICENSE_FILE`.
 * In `NODE_ENV=production`, license enforcement is enabled by default unless `MSX_LICENSE_ENFORCE=false`.
 * In local development/test mode, returns a permissive `dev-evaluation` result when `MSX_LICENSE_ENFORCE=true`
 * is not set and no invalid/expired key was supplied.
 */
export function resolveActiveEnterpriseLicense(): LicenseVerificationResult {
  const envKey = process.env["MSX_LICENSE_KEY"]?.trim() ?? "";
  const licenseFile = process.env["MSX_LICENSE_FILE"]?.trim() ?? "";
  const enforceEnv = process.env["MSX_LICENSE_ENFORCE"] ?? "";
  const nodeEnv = process.env["NODE_ENV"] ?? "";
  const pubKeyEnv = process.env["MSX_LICENSE_PUBLIC_KEY"] ?? "";

  let fileMtime = 0;
  if (!envKey && licenseFile && fs.existsSync(licenseFile)) {
    try {
      fileMtime = fs.statSync(licenseFile).mtimeMs;
    } catch {
      fileMtime = -1;
    }
  }

  const cacheKey = `${nodeEnv}|${enforceEnv}|${pubKeyEnv}|${envKey}|${licenseFile}:${fileMtime}`;
  const nowMs = Date.now();
  if (cachedLicenseResult && cachedLicenseCacheKey === cacheKey && nowMs - cachedLicenseAtMs < LICENSE_CACHE_TTL_MS) {
    return cachedLicenseResult;
  }

  let rawToken = envKey;
  if (!rawToken && licenseFile && fileMtime > 0) {
    try {
      rawToken = fs.readFileSync(licenseFile, "utf-8").trim();
    } catch {
      // Handled below
    }
  }

  if (rawToken) {
    const result = verifyEnterpriseLicense(rawToken);
    cachedLicenseCacheKey = cacheKey;
    cachedLicenseResult = result;
    cachedLicenseAtMs = nowMs;
    return result;
  }

  const strictEnforce = enforceEnv === "true" || (nodeEnv === "production" && enforceEnv !== "false");
  if (strictEnforce) {
    const result: LicenseVerificationResult = {
      valid: false,
      mode: "unlicensed",
      reason:
        "Missing Enterprise Edition license key (set MSX_LICENSE_KEY or MSX_LICENSE_FILE). Visit https://modelscript.org/pricing.",
    };
    cachedLicenseCacheKey = cacheKey;
    cachedLicenseResult = result;
    cachedLicenseAtMs = nowMs;
    return result;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const evalResult: LicenseVerificationResult = {
    valid: true,
    mode: "dev-evaluation",
    claims: {
      v: 1,
      jti: "lic_dev_eval",
      sub: "dev-workspace",
      org: "ModelScript Evaluation / Development Mode",
      tier: "appliance",
      seats: 0,
      features: [...ALL_ENTERPRISE_FEATURES],
      iat: nowSec,
      exp: nowSec + 86400 * 365,
    },
  };
  cachedLicenseCacheKey = cacheKey;
  cachedLicenseResult = evalResult;
  cachedLicenseAtMs = nowMs;
  return evalResult;
}
