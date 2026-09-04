#!/usr/bin/env node
// Downloads and extracts the Modelica Standard Library (MSL) if not already present.
// Supports both MSL 4.0.0 and MSL 4.1.0.
// Canonical download location: scripts/ModelicaStandardLibrary_v{version}.zip

const fs = require("fs");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

// Parse arguments
let version = "4.0.0";
let extract = false;
let outDir = path.join(__dirname, "msl");

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--version=")) {
    version = arg.split("=")[1].trim();
  } else if (arg === "4.0.0" || arg === "4.1.0") {
    version = arg;
  } else if (arg === "--extract" || arg === "-x") {
    extract = true;
  } else if (arg.startsWith("--outDir=")) {
    outDir = path.resolve(arg.split("=")[1].trim());
  }
}

const ZIP_NAME = `ModelicaStandardLibrary_v${version}.zip`;
const DEST = path.join(__dirname, ZIP_NAME);
const URL = `https://github.com/modelica/ModelicaStandardLibrary/releases/download/v${version}/${ZIP_NAME}`;

// Check if already extracted in outDir/Modelica {version} or OMC library path
const extractedDir = path.join(outDir, `Modelica ${version}`);
const omcDir = path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${version}+maint.om`);

if (fs.existsSync(extractedDir) && fs.existsSync(path.join(extractedDir, "package.mo"))) {
  console.log(`[download-msl] MSL ${version} already extracted at ${extractedDir}`);
  if (!fs.existsSync(DEST) && !extract) {
    // fine
  }
} else if (fs.existsSync(omcDir) && fs.existsSync(path.join(omcDir, "package.mo"))) {
  console.log(`[download-msl] Found local OpenModelica MSL ${version} at ${omcDir}`);
  if (extract && !fs.existsSync(extractedDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    try {
      fs.symlinkSync(omcDir, extractedDir, "junction");
      console.log(`[download-msl] Symlinked local MSL ${version} to ${extractedDir}`);
    } catch {
      // ignore
    }
  }
}

if (fs.existsSync(DEST)) {
  console.log(`[download-msl] ${ZIP_NAME} already exists, skipping download.`);
  if (extract && !fs.existsSync(extractedDir)) {
    unpackZip(DEST, outDir, version);
  }
  process.exit(0);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    follow(url);
  });
}

function unpackZip(zipPath, targetDir, ver) {
  console.log(`[download-msl] Extracting ${zipPath} to ${targetDir}...`);
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${targetDir}"`, { stdio: "inherit" });
    console.log(`[download-msl] Extracted MSL ${ver} to ${targetDir}`);
  } catch (err) {
    console.error(`[download-msl] Failed to extract zip: ${err.message}`);
  }
}

console.log(`[download-msl] Downloading ${ZIP_NAME} from ${URL}...`);

download(URL, DEST)
  .then(() => {
    console.log(`[download-msl] Downloaded to ${DEST}`);
    if (extract) {
      unpackZip(DEST, outDir, version);
    }
  })
  .catch((err) => {
    console.error(`[download-msl] Failed: ${err.message}`);
    // Clean up partial download
    try {
      fs.unlinkSync(DEST);
    } catch {
      // ignore
    }
    process.exit(1);
  });
