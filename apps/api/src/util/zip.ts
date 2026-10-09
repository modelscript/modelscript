// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

/**
 * Extract the content of the root-level package.mo file from a zip buffer.
 *
 * The root package.mo is identified as the `package.mo` file at the shallowest
 * depth in the archive. Commonly this is either `package.mo` or
 * `<LibraryName>/package.mo` (i.e. the zip contains a single top-level folder).
 */
export async function extractPackageMoFromZip(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip file"));
        return;
      }

      let bestMatch: { depth: number; entry: yauzl.Entry } | null = null;

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const fileName = entry.fileName;

        // Skip directories
        if (fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }

        // Check if this entry is a package.mo file
        const segments = fileName.split("/").filter((s) => s.length > 0);
        const baseName = segments[segments.length - 1];

        if (baseName === "package.mo") {
          const depth = segments.length;
          if (!bestMatch || depth < bestMatch.depth) {
            bestMatch = { depth, entry };
          }
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        if (!bestMatch) {
          reject(new Error("No package.mo file found in the zip archive"));
          return;
        }

        // Read the best matching entry
        zipfile.openReadStream(bestMatch.entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error("Failed to read package.mo from zip"));
            return;
          }

          const chunks: Buffer[] = [];
          readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
          readStream.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf-8"));
          });
          readStream.on("error", reject);
        });
      });

      zipfile.on("error", reject);
    });
  });
}

/**
 * Extract all files from a zip buffer into a target directory.
 */
export async function extractZipToDir(buffer: Buffer, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const safeTargetDir = path.resolve(targetDir);

    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip"));
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const entryPath = path.resolve(safeTargetDir, entry.fileName);
        if (!entryPath.startsWith(safeTargetDir + path.sep) && entryPath !== safeTargetDir) {
          zipfile.close();
          reject(new Error(`Zip Slip path traversal detected: illegal entry "${entry.fileName}"`));
          return;
        }

        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(entryPath, { recursive: true });
          zipfile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(entryPath), { recursive: true });

        zipfile.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error("Failed to read entry"));
            return;
          }

          const writeStream = fs.createWriteStream(entryPath);
          readStream.pipe(writeStream);
          writeStream.on("close", () => zipfile.readEntry());
          writeStream.on("error", reject);
        });
      });

      zipfile.on("end", resolve);
      zipfile.on("error", reject);
    });
  });
}

/**
 * Extract either package.json or package.mo from a zip buffer.
 * Prefers package.json at root if available, otherwise package.mo.
 */
export async function extractManifestFromZip(buffer: Buffer): Promise<{ type: "json" | "mo"; content: string }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip file"));
        return;
      }

      let bestJson: { depth: number; entry: yauzl.Entry } | null = null;
      let bestMo: { depth: number; entry: yauzl.Entry } | null = null;

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const fileName = entry.fileName;
        if (fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }

        const segments = fileName.split("/").filter((s) => s.length > 0);
        const baseName = segments[segments.length - 1];
        const depth = segments.length;

        if (baseName === "package.json") {
          if (!bestJson || depth < bestJson.depth) {
            bestJson = { depth, entry };
          }
        } else if (baseName === "package.mo") {
          if (!bestMo || depth < bestMo.depth) {
            bestMo = { depth, entry };
          }
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        const target = bestJson ?? bestMo;
        if (!target) {
          reject(new Error("No package.json or package.mo file found in the zip archive"));
          return;
        }

        const manifestType: "json" | "mo" = bestJson ? "json" : "mo";

        zipfile.openReadStream(target.entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error("Failed to read manifest from zip"));
            return;
          }

          const chunks: Buffer[] = [];
          readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
          readStream.on("end", () => {
            resolve({ type: manifestType, content: Buffer.concat(chunks).toString("utf-8") });
          });
          readStream.on("error", reject);
        });
      });

      zipfile.on("error", reject);
    });
  });
}

/**
 * Find the library root directory inside an extracted zip.
 * Looks for the shallowest `package.json` or `package.mo` file.
 */
export function findLibraryRoot(dir: string): string | null {
  // Check if package.json or package.mo is directly in the directory
  if (fs.existsSync(path.join(dir, "package.json")) || fs.existsSync(path.join(dir, "package.mo"))) {
    return dir;
  }

  // Check one level deeper (common: zip contains a single top-level folder)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const candidateJson = path.join(dir, entry.name, "package.json");
      const candidateMo = path.join(dir, entry.name, "package.mo");
      if (fs.existsSync(candidateJson) || fs.existsSync(candidateMo)) {
        return path.join(dir, entry.name);
      }
    }
  }

  return null;
}
