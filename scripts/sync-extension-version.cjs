const fs = require("fs");
const path = require("path");

const extPkgPath = path.resolve("dist/extension/package.json");
const runtimePkgPath = path.resolve("packages/runtime/package.json");

if (!fs.existsSync(extPkgPath)) {
  console.error(`Error: Extension package.json not found at ${extPkgPath}`);
  process.exit(1);
}

if (!fs.existsSync(runtimePkgPath)) {
  console.error(`Error: Runtime package.json not found at ${runtimePkgPath}`);
  process.exit(1);
}

const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf8"));
const runtimePkg = JSON.parse(fs.readFileSync(runtimePkgPath, "utf8"));

console.log(`Syncing extension version from ${extPkg.version} to ${runtimePkg.version}...`);
extPkg.version = runtimePkg.version;
fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");
console.log("Extension version synced successfully.");
