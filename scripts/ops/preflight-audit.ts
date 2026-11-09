// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript / Ansatz: Production Hardening & Pre-Flight Audit Sentinel
 *
 * Usage:
 *   npx tsx scripts/ops/preflight-audit.ts [--strict]
 *
 * Verifies host environment, kernel namespaces, sandboxing runtimes (bwrap),
 * secret entropy, storage permissions, and regulatory compliance readiness
 * prior to public paid commercial deployment.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

export interface AuditCheck {
  id: string;
  name: string;
  category: "sandbox" | "secrets" | "storage" | "network" | "compliance";
  level: "P0" | "P1" | "P2";
  passed: boolean;
  message: string;
  detail?: string | undefined;
}

export function runPreflightAudit(): { checks: AuditCheck[]; allPassed: boolean; criticalPassed: boolean } {
  const checks: AuditCheck[] = [];

  // ==========================================
  // Category 1: Untrusted Execution & Sandboxing
  // ==========================================
  {
    let bwrapPath: string | null = null;
    try {
      bwrapPath = execFileSync("which", ["bwrap"], { encoding: "utf-8" }).trim();
    } catch {
      bwrapPath = null;
    }

    if (!bwrapPath) {
      checks.push({
        id: "SANDBOX_BWRAP_INSTALLED",
        name: "Bubblewrap (bwrap) Binary Presence",
        category: "sandbox",
        level: "P0",
        passed: false,
        message: "bwrap binary not found in PATH.",
        detail: "Install bubblewrap (apt-get install -y bubblewrap) for rootless, unprivileged Linux sandboxing.",
      });
    } else {
      let bwrapWorks = false;
      let bwrapErr = "";
      try {
        execFileSync(bwrapPath, ["--unshare-net", "--ro-bind", "/", "/", "--dev", "/dev", "true"], {
          stdio: "pipe",
        });
        bwrapWorks = true;
      } catch (err: unknown) {
        bwrapErr = err instanceof Error ? err.message : String(err);
      }

      checks.push({
        id: "SANDBOX_BWRAP_UNSHARE_NET",
        name: "Bubblewrap Unprivileged User Namespaces & Network Isolation",
        category: "sandbox",
        level: "P0",
        passed: bwrapWorks,
        message: bwrapWorks
          ? `Bubblewrap rootless isolation verified at ${bwrapPath}.`
          : "Bubblewrap failed to isolate network/namespaces.",
        detail: bwrapErr || undefined,
      });
    }
  }

  // ==========================================
  // Category 2: Secrets & Cryptographic Entropy
  // ==========================================
  {
    const jwtSecret = process.env["JWT_SECRET"] || "";
    const isWeakJwt =
      jwtSecret.length < 32 || /^(secret|changeme|password|modelscript|ansatz|12345678|default)$/i.test(jwtSecret);

    checks.push({
      id: "SEC_JWT_ENTROPY",
      name: "JWT Signing Secret Entropy",
      category: "secrets",
      level: "P0",
      passed: !isWeakJwt && jwtSecret.length >= 32,
      message:
        jwtSecret.length >= 32 && !isWeakJwt
          ? "JWT secret has sufficient cryptographic length (>= 32 chars)."
          : "JWT_SECRET is missing, too short (< 32 chars), or matches known weak dictionary word.",
    });

    const stripeWebhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] || "";
    const hasStripeKey = Boolean(process.env["STRIPE_SECRET_KEY"]);
    if (hasStripeKey) {
      checks.push({
        id: "SEC_STRIPE_WEBHOOK_SECRET",
        name: "Stripe Webhook Signature Secret",
        category: "secrets",
        level: "P0",
        passed: stripeWebhookSecret.startsWith("whsec_"),
        message: stripeWebhookSecret.startsWith("whsec_")
          ? "STRIPE_WEBHOOK_SECRET format valid (starts with whsec_)."
          : "STRIPE_WEBHOOK_SECRET must be configured with a valid Stripe signing secret (starts with whsec_).",
      });
    }

    const auditHmacSecret = process.env["AUDIT_HMAC_SECRET"] || "";
    checks.push({
      id: "SEC_AUDIT_HMAC_SECRET",
      name: "Tamper-Proof Audit Log HMAC Key",
      category: "secrets",
      level: "P1",
      passed: auditHmacSecret.length >= 32,
      message:
        auditHmacSecret.length >= 32
          ? "AUDIT_HMAC_SECRET configured for cryptographic audit log sealing."
          : "AUDIT_HMAC_SECRET is recommended (>= 32 chars) to prevent tampering with historical audit ledgers.",
    });
  }

  // ==========================================
  // Category 3: Storage & Content Immutability
  // ==========================================
  {
    const storageDir = process.env["STORAGE_DIR"] || path.resolve(process.cwd(), "data/libraries");
    let storageWritable = false;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      const testFile = path.join(storageDir, `.msx-test-${Date.now()}`);
      fs.writeFileSync(testFile, "test", "utf-8");
      fs.unlinkSync(testFile);
      storageWritable = true;
    } catch {
      storageWritable = false;
    }

    checks.push({
      id: "STORAGE_WRITABLE",
      name: "Package Registry & CAS Storage Permissions",
      category: "storage",
      level: "P0",
      passed: storageWritable,
      message: storageWritable
        ? `Storage directory '${storageDir}' is writable.`
        : `Storage directory '${storageDir}' is not writable. Check volume permissions.`,
    });

    const isS3 = process.env["STORAGE_BACKEND"] === "s3";
    if (isS3) {
      const bucket = process.env["S3_BUCKET"];
      const keyId = process.env["S3_ACCESS_KEY_ID"];
      const secret = process.env["S3_SECRET_ACCESS_KEY"];
      const validS3 = Boolean(bucket && keyId && secret);

      checks.push({
        id: "STORAGE_S3_CREDENTIALS",
        name: "S3 / MinIO CAS Configuration",
        category: "storage",
        level: "P0",
        passed: validS3,
        message: validS3
          ? `S3 storage configured for bucket '${bucket}'.`
          : "S3_BUCKET, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY missing.",
      });
    }
  }

  // ==========================================
  // Category 4: Network, Rate Limiting & DoS
  // ==========================================
  {
    const redisUrl = process.env["REDIS_URL"];
    if (redisUrl) {
      let validUrl = false;
      try {
        const u = new URL(redisUrl);
        validUrl = u.protocol === "redis:" || u.protocol === "rediss:";
      } catch {
        validUrl = false;
      }

      checks.push({
        id: "NET_REDIS_URL",
        name: "Distributed Redis Cluster URL",
        category: "network",
        level: "P1",
        passed: validUrl,
        message: validUrl
          ? "REDIS_URL format is valid for distributed rate-limiting."
          : "REDIS_URL must use redis:// or rediss:// protocol.",
      });
    }

    const trustProxy = process.env["TRUST_PROXY"] === "true";
    checks.push({
      id: "NET_TRUST_PROXY",
      name: "Reverse-Proxy Trust Header Configuration",
      category: "network",
      level: "P1",
      passed: trustProxy || process.env["NODE_ENV"] !== "production",
      message: trustProxy
        ? "TRUST_PROXY=true configured for accurate IP rate limiting behind Cloudflare/Caddy."
        : "TRUST_PROXY should be 'true' in production to prevent IP spoofing.",
    });
  }

  // ==========================================
  // Category 5: Regulatory Compliance & Edition
  // ==========================================
  {
    const edition = process.env["MSX_EDITION"] || "ce";
    if (edition === "ee") {
      const enforceLicense = process.env["MSX_LICENSE_ENFORCE"] === "true";
      const hasKey = Boolean(process.env["MSX_LICENSE_KEY"]);

      checks.push({
        id: "EE_LICENSE_ENFORCEMENT",
        name: "Enterprise Edition License Enforcement",
        category: "compliance",
        level: "P0",
        passed: !enforceLicense || hasKey,
        message:
          !enforceLicense || hasKey
            ? "Enterprise license configuration valid."
            : "MSX_LICENSE_ENFORCE is true but MSX_LICENSE_KEY is not provided.",
      });
    }
  }

  const criticalFailed = checks.filter((c) => c.level === "P0" && !c.passed);
  const anyFailed = checks.filter((c) => !c.passed);

  return {
    checks,
    allPassed: anyFailed.length === 0,
    criticalPassed: criticalFailed.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("================================================================================");
  console.log(" ModelScript / Ansatz: Production Hardening Pre-Flight Audit Sentinel");
  console.log(` Host:     ${os.hostname()} (${os.platform()} ${os.arch()})`);
  console.log(` Time:     ${new Date().toISOString()}`);
  console.log("================================================================================");

  const result = runPreflightAudit();
  let failCount = 0;

  for (const check of result.checks) {
    const symbol = check.passed ? "✓" : check.level === "P0" ? "🚨 FAIL" : "⚠️  WARN";
    console.log(`[${symbol}] [${check.level}] ${check.name}`);
    console.log(`      ${check.message}`);
    if (check.detail && !check.passed) {
      console.log(`      Detail: ${check.detail}`);
    }
    if (!check.passed && check.level === "P0") {
      failCount++;
    }
  }

  console.log("================================================================================");
  if (result.criticalPassed) {
    console.log("✓ PRE-FLIGHT AUDIT PASSED: System meets production hardening requirements.");
    process.exit(0);
  } else {
    console.error(`🚨 PRE-FLIGHT AUDIT FAILED: ${failCount} critical (P0) security check(s) failed.`);
    process.exit(1);
  }
}
