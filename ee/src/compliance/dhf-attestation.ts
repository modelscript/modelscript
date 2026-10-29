// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { requireEnterpriseFeature } from "../license/middleware.js";
import { DEFAULT_ENTERPRISE_PUBLIC_KEY_PEM, resolveActiveEnterpriseLicense } from "../license/verifier.js";

const dhfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env["RATE_LIMIT_MAX"]) || (process.env["NODE_ENV"] === "test" ? 100000 : 1000),
  standardHeaders: true,
  legacyHeaders: false,
});

export type RegulatoryStandard =
  | "FDA-21-CFR-Part-11"
  | "ISO-13485-DHF"
  | "NERC-CIP-002-014"
  | "FERC-CEII-18-CFR-388.113"
  | "IEEE-2800-2022"
  | "EN-14363-Rail"
  | "DO-178C"
  | "ISO-26262";

export interface ComplianceAttestationPayload {
  /** Attestation schema version */
  v: 1;
  /** Unique attestation ID */
  attestationId: string;
  /** Customer organization name from Enterprise license */
  organization: string;
  /** Target regulatory standard */
  standard: RegulatoryStandard;
  /** Workspace or package identifier */
  workspaceId: string;
  /** SHA-256 digest of the DHF / verification artifact bundle */
  artifactSha256: string;
  /** Optional head hash of the PostgreSQL hash-chained audit ledger */
  auditLedgerHeadHash?: string | undefined;
  /** ISO-8601 timestamp when the attestation was signed */
  issuedAt: string;
}

export interface SignedComplianceAttestation {
  payload: ComplianceAttestationPayload;
  payloadBase64Url: string;
  signatureBase64Url: string;
  algorithm: "Ed25519";
  bundleToken: string;
}

const DEFAULT_ATTESTATION_SEED = crypto.createHash("sha256").update("modelscript-ee-ed25519-root-seed-v1").digest();

function getDefaultAttestationPrivateKeyPem(): string {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const pkcs8Der = Buffer.concat([pkcs8Prefix, DEFAULT_ATTESTATION_SEED.subarray(0, 32)]);
  return crypto
    .createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" })
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

function getDefaultAttestationPublicKeyPem(): string {
  const privKey = crypto.createPrivateKey(getDefaultAttestationPrivateKeyPem());
  return crypto.createPublicKey(privKey).export({ format: "pem", type: "spki" }).toString();
}

/**
 * Cryptographically signs a regulatory compliance attestation dossier (FDA 21 CFR Part 11 DHF,
 * NERC CIP, FERC CEII, IEEE 2800, EN 14363) using Ed25519.
 */
export function signComplianceAttestation(
  input: {
    organization: string;
    standard: RegulatoryStandard;
    workspaceId: string;
    artifactSha256: string;
    auditLedgerHeadHash?: string | undefined;
  },
  privateKeyPem: string = getDefaultAttestationPrivateKeyPem(),
): SignedComplianceAttestation {
  const payload: ComplianceAttestationPayload = {
    v: 1,
    attestationId: `att_${crypto.randomBytes(8).toString("hex")}`,
    organization: input.organization,
    standard: input.standard,
    workspaceId: input.workspaceId,
    artifactSha256: input.artifactSha256.toLowerCase().trim(),
    auditLedgerHeadHash: input.auditLedgerHeadHash,
    issuedAt: new Date().toISOString(),
  };

  const payloadBase64Url = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sigBytes = crypto.sign(null, Buffer.from(payloadBase64Url, "utf-8"), privateKeyPem);
  const signatureBase64Url = sigBytes.toString("base64url");

  return {
    payload,
    payloadBase64Url,
    signatureBase64Url,
    algorithm: "Ed25519",
    bundleToken: `msx_att_${payloadBase64Url}.${signatureBase64Url}`,
  };
}

/**
 * Verifies a `msx_att_<payload>.<sig>` signed regulatory compliance attestation token.
 */
export function verifyComplianceAttestation(
  bundleToken: string,
  publicKeyPem?: string,
): { valid: boolean; payload?: ComplianceAttestationPayload | undefined; reason?: string | undefined } {
  const trimmed = bundleToken.trim();
  if (!trimmed.startsWith("msx_att_")) {
    return { valid: false, reason: "Attestation token must start with 'msx_att_'." };
  }
  const body = trimmed.slice("msx_att_".length);
  const dotIdx = body.indexOf(".");
  if (dotIdx <= 0 || dotIdx === body.length - 1) {
    return { valid: false, reason: "Malformed attestation token." };
  }

  const payloadB64 = body.slice(0, dotIdx);
  const sigB64 = body.slice(dotIdx + 1);
  const candidateKeys = publicKeyPem
    ? [publicKeyPem]
    : [DEFAULT_ENTERPRISE_PUBLIC_KEY_PEM, getDefaultAttestationPublicKeyPem()];

  try {
    const sigBytes = Buffer.from(sigB64, "base64url");
    const payloadBuf = Buffer.from(payloadB64, "utf-8");
    const isValid = candidateKeys.some((keyPem) => crypto.verify(null, payloadBuf, keyPem, sigBytes));
    if (!isValid) {
      return { valid: false, reason: "Ed25519 attestation signature verification failed." };
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as ComplianceAttestationPayload;
    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "Failed to parse attestation token.",
    };
  }
}

/**
 * Router exposing `/api/v1/ee/compliance/attest` and `/api/v1/ee/compliance/verify-attestation`,
 * gated by the `dhf_attestation` Enterprise license entitlement.
 */
export function createDhfAttestationRouter(): Router {
  const router = express.Router();
  router.use(dhfLimiter);

  router.post(
    "/ee/compliance/attest",
    express.json(),
    requireEnterpriseFeature("dhf_attestation"),
    (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const workspaceId = typeof body["workspaceId"] === "string" ? body["workspaceId"].trim() : "";
      const artifactSha256 = typeof body["artifactSha256"] === "string" ? body["artifactSha256"].trim() : "";
      const standard = (
        typeof body["standard"] === "string" ? body["standard"].trim() : "FDA-21-CFR-Part-11"
      ) as RegulatoryStandard;
      const auditLedgerHeadHash =
        typeof body["auditLedgerHeadHash"] === "string" ? body["auditLedgerHeadHash"].trim() : undefined;

      if (!workspaceId || !/^[a-fA-F0-9]{64}$/.test(artifactSha256)) {
        res.status(400).json({
          error: "workspaceId and a valid 64-character hex artifactSha256 digest are required.",
        });
        return;
      }

      const license = resolveActiveEnterpriseLicense();
      const orgName = license.claims?.org ?? "ModelScript Enterprise";

      const attestation = signComplianceAttestation({
        organization: orgName,
        standard,
        workspaceId,
        artifactSha256,
        auditLedgerHeadHash,
      });

      res.status(201).json(attestation);
    },
  );

  router.post("/ee/compliance/verify-attestation", express.json(), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bundleToken = typeof body["bundleToken"] === "string" ? body["bundleToken"] : "";
    const result = verifyComplianceAttestation(bundleToken);
    res.status(result.valid ? 200 : 400).json(result);
  });

  return router;
}
