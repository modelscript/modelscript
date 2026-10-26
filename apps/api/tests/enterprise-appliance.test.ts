// SPDX-License-Identifier: AGPL-3.0-or-later

process.env["NODE_ENV"] = "test";
process.env["ENTERPRISE_APPLIANCE"] = "true";
process.env["AIRGAP_ENFORCED"] = "true";
process.env["ENTERPRISE_HEADER_AUTH"] = "true";
process.env["TRUST_PROXY"] = "true";
process.env["TRUSTED_PROXY_IPS"] = "127.0.0.1,::1,10.0.0.1";
process.env["ENTERPRISE_ADMIN_GROUPS"] = "AD-Transmission-Planning-Admins,Engineering-Admins";

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { setAuthDatabase } from "../src/middleware/auth-middleware.js";

console.log("=== Running Hardened Enterprise Intranet Appliance Test Suite ===");

const tmpDir = path.join(os.tmpdir(), "modelscript-appliance-test-" + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

// Setup fake static web and ide dist directories for testing SPA mounting
const fakeWebDir = path.join(tmpDir, "web-dist");
const fakeIdeDir = path.join(tmpDir, "ide-dist");
fs.mkdirSync(fakeWebDir, { recursive: true });
fs.mkdirSync(fakeIdeDir, { recursive: true });

fs.writeFileSync(
  path.join(fakeWebDir, "index.html"),
  "<!DOCTYPE html><html><head><title>ModelScript Web</title></head><body><div id='root'>Appliance Web App</div></body></html>",
);
fs.writeFileSync(path.join(fakeWebDir, "bundle.js"), "console.log('ModelScript SPA Asset');");
fs.writeFileSync(
  path.join(fakeIdeDir, "index.html"),
  "<!DOCTYPE html><html><head><title>ModelScript IDE</title></head><body>IDE Workbench</body></html>",
);

process.env["STATIC_WEB_DIR"] = fakeWebDir;
process.env["STATIC_IDE_DIR"] = fakeIdeDir;

const dbPath = path.join(tmpDir, "appliance.db");
const database = new LibraryDatabase(dbPath);
setAuthDatabase(database);

const app = createApp({ database });

// ============================================================================
// TEST 1: Air-Gap Compliance Readiness Probe & Metadata
// ============================================================================
console.log("1. Testing /api/v1/compliance/airgap probe...");
const airgapRes = await request(app).get("/api/v1/compliance/airgap");
assert.strictEqual(airgapRes.status, 200, "Airgap probe must return 200");
assert.strictEqual(airgapRes.body.status, "enforced", "Status must be enforced");
assert.strictEqual(airgapRes.body.ceiiCompliant, true, "Must be CEII compliant");
assert.strictEqual(airgapRes.body.nercCipCompliant, true, "Must be NERC CIP compliant");
assert.strictEqual(airgapRes.body.outboundTrafficBlocked, true, "Outbound traffic must be blocked");
assert.strictEqual(airgapRes.body.applianceMode, true, "Appliance mode must be reported");
console.log("✓ Test 1 passed: Air-gap compliance probe verified.");

// ============================================================================
// TEST 2: Air-Gap Strict Content Security Policy (CSP) Headers
// ============================================================================
console.log("2. Testing strict Air-Gap CSP and regulatory response headers...");
const healthRes = await request(app).get("/health");
assert.strictEqual(healthRes.status, 200);

const csp = healthRes.headers["content-security-policy"];
assert.ok(csp, "Content-Security-Policy header must be present");
assert.ok(csp.includes("default-src 'self'"), "CSP must lock default-src to 'self'");
assert.ok(csp.includes("'wasm-unsafe-eval'"), "CSP must allow WebAssembly JIT evaluation");
assert.ok(csp.includes("object-src 'none'"), "CSP must disallow plugins/object-src");
assert.strictEqual(healthRes.headers["x-airgap-enforced"], "true", "X-Airgap-Enforced header missing");
assert.strictEqual(healthRes.headers["x-ceii-compliance"], "FERC-18-CFR-388.113", "X-CEII-Compliance header missing");
console.log("✓ Test 2 passed: Strict CSP and CEII headers verified.");

// ============================================================================
// TEST 3: Enterprise Reverse-Proxy / SAML Header Authentication (JIT Provisioning)
// ============================================================================
console.log("3. Testing SAML / reverse-proxy header authentication and JIT user provisioning...");
// Call an authenticated endpoint using X-Forwarded-User from a trusted proxy
const authRes = await request(app)
  .get("/api/v1/auth/me")
  .set("X-Forwarded-For", "127.0.0.1")
  .set("X-Forwarded-User", "john_planner")
  .set("X-Forwarded-Email", "john.planner@ercot.com")
  .set("X-Forwarded-Groups", "Transmission-Planning,Grid-Operations");

assert.strictEqual(authRes.status, 200, "Header auth must succeed for trusted proxy");
assert.strictEqual(authRes.body.user.username, "john_planner");
assert.strictEqual(authRes.body.user.email, "john.planner@ercot.com");
assert.strictEqual(authRes.body.user.account_type, "user", "Standard groups should yield user role");

// Verify that user was created in SQLite database
const createdUser = database.getUserByUsername("john_planner");
assert.ok(createdUser, "User must be persisted in database");
assert.strictEqual(createdUser.email, "john.planner@ercot.com");
console.log("✓ Test 3 passed: JIT user provisioned and authenticated via SAML proxy headers.");

// ============================================================================
// TEST 4: Role Elevation via Enterprise Active Directory Groups
// ============================================================================
console.log("4. Testing role elevation for enterprise admin security groups...");
const adminAuthRes = await request(app)
  .get("/api/v1/auth/me")
  .set("X-Forwarded-For", "127.0.0.1")
  .set("X-Forwarded-User", "sarah_admin")
  .set("X-Forwarded-Email", "sarah.admin@ercot.com")
  .set("X-Forwarded-Groups", "Grid-Operations,AD-Transmission-Planning-Admins");

assert.strictEqual(adminAuthRes.status, 200);
assert.strictEqual(adminAuthRes.body.user.username, "sarah_admin");
assert.strictEqual(adminAuthRes.body.user.account_type, "admin", "Admin security group must elevate role to admin");

const adminUser = database.getUserByUsername("sarah_admin");
assert.strictEqual(adminUser?.account_type, "admin", "Database record must be admin");
console.log("✓ Test 4 passed: Role elevated to admin based on AD-Transmission-Planning-Admins group.");

// ============================================================================
// TEST 5: Anti-Spoofing Security: Reject Headers from Untrusted Proxy IP
// ============================================================================
console.log("5. Testing anti-spoofing rejection for untrusted client IP...");
const spoofRes = await request(app)
  .get("/api/v1/auth/me")
  .set("X-Forwarded-For", "198.51.100.77") // External/untrusted IP
  .set("X-Forwarded-User", "malicious_attacker")
  .set("X-Forwarded-Email", "attacker@evil.com");

assert.strictEqual(spoofRes.status, 401, "Header auth from untrusted IP must be rejected");
assert.strictEqual(spoofRes.body.error, "Authentication required");
console.log("✓ Test 5 passed: Untrusted proxy headers successfully blocked.");

// ============================================================================
// TEST 6: Static Web SPA Asset Delivery & Client-Side SPA Fallback
// ============================================================================
console.log("6. Testing single-container static Web SPA and IDE mounting...");
// Test static asset
const assetRes = await request(app).get("/bundle.js");
assert.strictEqual(assetRes.status, 200);
assert.ok(assetRes.text.includes("ModelScript SPA Asset"));

// Test IDE static mount
const ideRes = await request(app).get("/ide/index.html");
assert.strictEqual(ideRes.status, 200);
assert.ok(ideRes.text.includes("IDE Workbench"));

// Test SPA wildcard fallback for deep client route (e.g. /solutions/@ercot/inverter-model)
const spaRes = await request(app).get("/solutions/@ercot/inverter-model");
assert.strictEqual(spaRes.status, 200);
assert.ok(spaRes.text.includes("ModelScript Web"), "SPA route must fall back to index.html");
console.log("✓ Test 6 passed: Static Web SPA and IDE delivered with client-side SPA routing.");

// Clean up temporary directory
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("\n=======================================================");
console.log("ALL 6 HARDENED ENTERPRISE APPLIANCE TESTS PASSED!");
console.log("=======================================================\n");
