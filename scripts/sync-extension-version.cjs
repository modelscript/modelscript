// SPDX-License-Identifier: AGPL-3.0-or-later

const fs = require("fs");
const path = require("path");

const runtimePkgPath = path.resolve("packages/runtime/package.json");
if (!fs.existsSync(runtimePkgPath)) {
  console.error(`Error: Runtime package.json not found at ${runtimePkgPath}`);
  process.exit(1);
}

const runtimePkg = JSON.parse(fs.readFileSync(runtimePkgPath, "utf8"));
const targetVersion = runtimePkg.version;

const extCandidates = [
  path.resolve("dist/extension/package.json"),
  path.resolve("apps/ide/dist/extension/package.json"),
];

let syncedCount = 0;
for (const extPkgPath of extCandidates) {
  if (fs.existsSync(extPkgPath)) {
    const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf8"));
    console.log(`Syncing ${path.relative(process.cwd(), extPkgPath)} from ${extPkg.version} to ${targetVersion}...`);
    extPkg.version = targetVersion;
    fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");
    syncedCount++;
  }
}

if (syncedCount === 0) {
  console.error("Error: No extension package.json found in dist/extension or apps/ide/dist/extension");
  process.exit(1);
}
console.log("Extension version synced successfully.");
