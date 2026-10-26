// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAirgapCompliance, getDesktopSystemInfo, isTauriEnvironment } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const tauriDir = path.resolve(desktopRoot, "src-tauri");
const repoRoot = path.resolve(desktopRoot, "../..");

console.log("=== Running Tauri v2 Desktop Packaging Configuration Test Suite ===");

// ============================================================================
// TEST 1: tauri.conf.json Validation (Tauri v2 Schema & Compliance)
// ============================================================================
console.log("1. Validating tauri.conf.json against Tauri v2 specifications...");
const tauriConfPath = path.resolve(tauriDir, "tauri.conf.json");
assert.ok(fs.existsSync(tauriConfPath), "tauri.conf.json must exist in src-tauri/");

const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
assert.strictEqual(conf.$schema, "https://schema.tauri.app/config/2", "Must target Tauri v2 config schema");
assert.strictEqual(conf.productName, "ModelScript", "Product name must be ModelScript");
assert.strictEqual(conf.identifier, "org.modelscript.desktop", "Bundle identifier mismatch");

// Verify build settings
assert.strictEqual(conf.build.frontendDist, "../../web/dist", "frontendDist must point to built web dist");
assert.ok(conf.build.beforeBuildCommand.includes("@modelscript/web"), "Must build web frontend before packaging");

// Verify windowing & withGlobalTauri
assert.strictEqual(conf.app.withGlobalTauri, true, "withGlobalTauri must be enabled for TypeScript bridge");
assert.ok(Array.isArray(conf.app.windows) && conf.app.windows.length >= 1, "Must configure at least 1 window");
const mainWin = conf.app.windows[0];
assert.strictEqual(mainWin.label, "main", "Primary window label must be main");
assert.strictEqual(mainWin.theme, "Dark", "Default theme should be Dark");
assert.ok(mainWin.width >= 1024, "Window width must be at least 1024");
assert.ok(mainWin.height >= 680, "Window height must be at least 680");

// Verify Air-Gap & Security CSP
const csp = conf.app.security.csp;
assert.ok(csp.includes("'wasm-unsafe-eval'"), "CSP must permit wasm-unsafe-eval for WebAssembly simulations");
assert.ok(csp.includes("blob:"), "CSP must permit blob: for WebWorker emulation");
assert.ok(csp.includes("tauri:"), "CSP must permit tauri: protocol");

// Verify Multi-Target Bundling
const targets = conf.bundle.targets;
assert.ok(
  targets === "all" || (Array.isArray(targets) && targets.includes("msi") && targets.includes("nsis")),
  "Bundle targets must support Windows MSI and NSIS",
);

// Verify Zero-Admin NSIS Mode for Enterprise Utility Workstations
assert.strictEqual(
  conf.bundle.windows?.nsis?.installMode,
  "currentUser",
  "NSIS installMode must be 'currentUser' to allow zero-admin installation into %LOCALAPPDATA%",
);

console.log("✓ Test 1 passed: tauri.conf.json conforms to Tauri v2 and utility compliance standards.");

// ============================================================================
// TEST 2: Capabilities Configuration (Granular Tauri v2 Permissions)
// ============================================================================
console.log("2. Validating Tauri v2 capabilities and permissions...");
const capPath = path.resolve(tauriDir, "capabilities/default.json");
assert.ok(fs.existsSync(capPath), "capabilities/default.json must exist");

const cap = JSON.parse(fs.readFileSync(capPath, "utf-8"));
assert.strictEqual(cap.identifier, "default", "Capability identifier must be default");
assert.ok(cap.windows.includes("main"), "Capability must apply to main window");

const perms: string[] = cap.permissions;
assert.ok(perms.includes("core:default"), "Must grant core:default");
assert.ok(perms.includes("fs:default"), "Must grant fs:default for local-first storage");
assert.ok(perms.includes("dialog:default"), "Must grant dialog:default for native file pickers");
assert.ok(perms.includes("shell:default"), "Must grant shell:default for launching external viewers");
assert.ok(perms.includes("os:default"), "Must grant os:default for hardware detection");

console.log("✓ Test 2 passed: Tauri v2 fine-grained capabilities verified.");

// ============================================================================
// TEST 3: Cargo.toml & Size-Optimized Release Profile
// ============================================================================
console.log("3. Validating Cargo.toml dependencies and release profile...");
const cargoPath = path.resolve(tauriDir, "Cargo.toml");
assert.ok(fs.existsSync(cargoPath), "Cargo.toml must exist");

const cargoContent = fs.readFileSync(cargoPath, "utf-8");
assert.ok(cargoContent.includes('tauri = { version = "2"'), "Cargo.toml must depend on tauri v2");
assert.ok(cargoContent.includes("tauri-plugin-fs"), "Must depend on tauri-plugin-fs");
assert.ok(cargoContent.includes("tauri-plugin-dialog"), "Must depend on tauri-plugin-dialog");

// Verify size optimization profile for enterprise < 12 MB binary target
assert.ok(cargoContent.includes('opt-level = "z"'), "Release profile must use opt-level = 'z' for size");
assert.ok(cargoContent.includes("lto = true"), "Release profile must enable Link-Time Optimization (LTO)");
assert.ok(cargoContent.includes("strip = true"), "Release profile must strip symbols");

console.log("✓ Test 3 passed: Cargo.toml and size optimization profile verified.");

// ============================================================================
// TEST 4: Zero-Custom-Rust Verification (Generic 3-Line Boilerplate)
// ============================================================================
console.log("4. Verifying that Rust is 100% generic untouched boilerplate (no custom Rust)...");
const libPath = path.resolve(tauriDir, "src/lib.rs");
const mainPath = path.resolve(tauriDir, "src/main.rs");
assert.ok(fs.existsSync(libPath), "src/lib.rs must exist");
assert.ok(fs.existsSync(mainPath), "src/main.rs must exist");

const libContent = fs.readFileSync(libPath, "utf-8");
// Verify lib.rs contains NO custom command structs or business logic
assert.ok(!libContent.includes("struct DesktopSystemInfo"), "lib.rs must not contain custom domain structs");
assert.ok(!libContent.includes("fn check_airgap_compliance"), "lib.rs must not contain custom Rust commands");
assert.ok(libContent.includes("tauri::Builder::default()"), "lib.rs must only contain standard plugin wiring");

const mainContent = fs.readFileSync(mainPath, "utf-8");
assert.ok(mainContent.includes('windows_subsystem = "windows"'), "main.rs must suppress Windows console window");
assert.ok(mainContent.includes("modelscript_desktop_lib::run()"), "main.rs must invoke lib run()");

console.log("✓ Test 4 passed: Rust host is a pure generic boilerplate stub with zero custom domain code.");

// ============================================================================
// TEST 5: Pure TypeScript Desktop Bridge & Compliance
// ============================================================================
console.log("5. Testing pure TypeScript desktop bridge and air-gap checks...");
assert.strictEqual(typeof isTauriEnvironment, "function", "isTauriEnvironment must be exported");

const airgap = checkAirgapCompliance();
assert.strictEqual(airgap.compliant, true, "Desktop air-gap compliance must be true");
assert.strictEqual(airgap.outboundTrafficBlocked, true, "Outbound telemetry must be blocked");
assert.strictEqual(airgap.localStorageOnly, true, "Local storage only must be true");
assert.ok(airgap.details.length >= 3, "Air-gap report must provide regulatory compliance details");

const sysInfo = await getDesktopSystemInfo();
assert.strictEqual(sysInfo.ceiiComplianceReady, true, "CEII compliance must be ready");
assert.strictEqual(sysInfo.airgapEnforced, true, "Airgap must be enforced");

console.log("✓ Test 5 passed: Pure TypeScript desktop bridge and air-gap compliance verified.");

// ============================================================================
// TEST 6: Multi-Resolution Icon Assets & CI/CD Workflow
// ============================================================================
console.log("6. Validating multi-resolution desktop icon assets and CI/CD workflow...");
const iconNames = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns"];
for (const name of iconNames) {
  const iconFile = path.resolve(tauriDir, "icons", name);
  assert.ok(fs.existsSync(iconFile), `Icon asset '${name}' must exist in src-tauri/icons/`);
  const stat = fs.statSync(iconFile);
  assert.ok(stat.size > 0, `Icon asset '${name}' must not be empty`);
}

const ciWorkflowPath = path.resolve(repoRoot, ".github/workflows/desktop-packaging.yml");
assert.ok(fs.existsSync(ciWorkflowPath), "GitHub Actions desktop-packaging.yml workflow must exist");
const ciContent = fs.readFileSync(ciWorkflowPath, "utf-8");
assert.ok(ciContent.includes("windows-latest"), "CI must build on windows-latest");
assert.ok(ciContent.includes("ubuntu-22.04"), "CI must build on ubuntu-22.04");
assert.ok(ciContent.includes("macos-latest"), "CI must build on macos-latest");

console.log("✓ Test 6 passed: Icons and cross-platform GitHub Actions workflow verified.");

console.log("\n=======================================================");
console.log("ALL 6 TAURI V2 DESKTOP CONFIGURATION TESTS PASSED!");
console.log("=======================================================\n");
