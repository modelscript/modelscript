#!/usr/bin/env node
// Downloads the Modelica Standard Library zip if not already present.
// Shared by both morsel (public/) and vscode/lsp (server/dist/).
// Canonical download location: scripts/ModelicaStandardLibrary_v4.1.0.zip

const fs = require("fs");
const https = require("https");
const path = require("path");

const ZIP_NAME = "ModelicaStandardLibrary_v4.1.0.zip";
const DEST = path.join(__dirname, ZIP_NAME);
const URL = `https://github.com/modelica/ModelicaStandardLibrary/releases/download/v4.1.0/${ZIP_NAME}`;

if (fs.existsSync(DEST)) {
  console.log(`[download-msl] ${ZIP_NAME} already exists, skipping download.`);
  process.exit(0);
}

console.log(`[download-msl] Downloading ${ZIP_NAME}...`);

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

download(URL, DEST)
  .then(() => console.log(`[download-msl] Downloaded to ${DEST}`))
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
