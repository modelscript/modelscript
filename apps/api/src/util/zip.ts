// SPDX-License-Identifier: AGPL-3.0-or-later

import { detectAndAdaptArchiveManifest, readZipTextEntries } from "@modelscript/exchange";
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

const MAX_ZIP_ENTRIES = 10_000;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250 MB

/**
 * Extract the content of the root-level package.mo file from a zip buffer.
 *
 * The root package.mo is identified as the `package.mo` file at the shallowest
 * depth in the archive. Commonly this is either `package.mo` or
 * `<LibraryName>/package.mo` (i.e. the zip contains a single top-level folder).
 */
export async function extractPackageMoFromZip(buffer: Buffer, preferredName?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip file"));
        return;
      }

      let bestMatch: { depth: number; matchesName: boolean; entry: yauzl.Entry } | null = null;
      const cleanPref = preferredName ? preferredName.split("/").pop()!.toLowerCase() : "";

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
          const topFolder = (segments[0] || "").toLowerCase();
          const matchesName = Boolean(
            cleanPref &&
            (topFolder === cleanPref || topFolder.startsWith(`${cleanPref} `) || topFolder.startsWith(`${cleanPref}-`)),
          );
          if (
            !bestMatch ||
            depth < bestMatch.depth ||
            (depth === bestMatch.depth && matchesName && !bestMatch.matchesName)
          ) {
            bestMatch = { depth, matchesName, entry };
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
          let totalRead = 0;
          readStream.on("data", (chunk: Buffer) => {
            totalRead += chunk.length;
            if (totalRead > MAX_SINGLE_FILE_BYTES) {
              readStream.destroy(new Error("package.mo exceeds maximum allowed size (50 MB)"));
              return;
            }
            chunks.push(chunk);
          });
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
    let entryCount = 0;
    let totalBytesWritten = 0;
    let settled = false;

    const fail = (err: Error, zipfile?: yauzl.ZipFile) => {
      if (settled) return;
      settled = true;
      try {
        zipfile?.close();
      } catch {
        // Ignore close error
      }
      reject(err);
    };

    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        fail(err ?? new Error("Failed to open zip"));
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (settled) return;
        entryCount++;
        if (entryCount > MAX_ZIP_ENTRIES) {
          fail(new Error(`Zip archive exceeds maximum entry count (${MAX_ZIP_ENTRIES})`), zipfile);
          return;
        }

        const entryPath = path.resolve(safeTargetDir, entry.fileName);
        if (!entryPath.startsWith(safeTargetDir + path.sep) && entryPath !== safeTargetDir) {
          fail(new Error(`Zip Slip path traversal detected: illegal entry "${entry.fileName}"`), zipfile);
          return;
        }

        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(entryPath, { recursive: true });
          zipfile.readEntry();
          return;
        }

        if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
          fail(new Error(`Zip entry "${entry.fileName}" exceeds maximum single-file size`), zipfile);
          return;
        }

        fs.mkdirSync(path.dirname(entryPath), { recursive: true });

        zipfile.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            fail(err ?? new Error("Failed to read entry"), zipfile);
            return;
          }

          const writeStream = fs.createWriteStream(entryPath);
          readStream.on("data", (chunk: Buffer) => {
            totalBytesWritten += chunk.length;
            if (totalBytesWritten > MAX_TOTAL_UNCOMPRESSED_BYTES) {
              readStream.destroy(new Error("Zip archive exceeds maximum total uncompressed size (250 MB)"));
            }
          });
          readStream.on("error", (streamErr) => {
            writeStream.destroy();
            fail(streamErr, zipfile);
          });
          writeStream.on("error", (writeErr) => {
            readStream.destroy();
            fail(writeErr, zipfile);
          });
          writeStream.on("close", () => {
            if (!settled) zipfile.readEntry();
          });
          readStream.pipe(writeStream);
        });
      });

      zipfile.on("end", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zipfile.on("error", (zipErr) => fail(zipErr, zipfile));
    });
  });
}

const RECOGNIZED_NATIVE_MANIFEST_FILES = new Set([
  "package.json",
  "modelscript.json",
  "package.mo",
  ".meta.json",
  "impact.json",
  "ddp-manifest.json",
  "aas.json",
  "okh.json",
  "modelDescription.xml",
  "SystemStructure.ssd",
  "manifest.xml",
  "package.xml",
  "model.config",
  "fpm.toml",
  "datapackage.json",
  "component.xml",
  "workspace.xml",
]);

/**
 * Extract manifest (`package.json`, `modelscript.json`, `package.mo`, or adapted native manifest
 * from `.kpar`, `.fmu`, `.ssp`, `.ddp`, `.aasx`, `.omex`, `.reqifz`, `.slx`, ROS `package.xml`, `fpm.toml`, etc.)
 * from a zip buffer.
 */
export async function extractManifestFromZip(
  buffer: Buffer,
  options?: { fallbackName?: string | undefined; fallbackVersion?: string | undefined },
): Promise<{ type: "json" | "mo"; content: string; format?: string | undefined }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open zip file"));
        return;
      }

      let bestJson: { depth: number; entry: yauzl.Entry } | null = null;
      let bestMo: { depth: number; entry: yauzl.Entry } | null = null;
      let hasNativeIndicator = false;

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const fileName = entry.fileName;
        if (fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }

        const segments = fileName.split("/").filter((s) => s.length > 0);
        const baseName = segments[segments.length - 1] ?? "";
        const depth = segments.length;

        if (baseName === "package.json" || baseName === "modelscript.json") {
          if (!bestJson || depth < bestJson.depth) {
            bestJson = { depth, entry };
          }
        } else if (baseName === "package.mo") {
          if (!bestMo || depth < bestMo.depth) {
            bestMo = { depth, entry };
          }
        } else if (
          RECOGNIZED_NATIVE_MANIFEST_FILES.has(baseName) ||
          baseName.endsWith(".reqif") ||
          baseName.endsWith(".ssd") ||
          baseName.endsWith(".pswx") ||
          baseName.endsWith(".pslx") ||
          fileName.endsWith("simulink/blockdiagram.xml")
        ) {
          hasNativeIndicator = true;
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        const target = bestJson ?? bestMo;
        if (!target) {
          if (hasNativeIndicator) {
            try {
              const { textFiles } = readZipTextEntries(
                new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
              );
              if (textFiles.size > 0) {
                const adapted = detectAndAdaptArchiveManifest(textFiles, options);
                resolve({
                  type: "json",
                  content: JSON.stringify(adapted.packageJson, null, 2),
                  format: adapted.format,
                });
                return;
              }
            } catch {
              // Fall through to reject
            }
          }
          reject(
            new Error(
              "No package.json, modelscript.json, package.mo, or supported native package manifest (.kpar, .fmu, .ssp, .ddp, .aasx, .omex, .reqifz, .slx, package.xml, fpm.toml) found in the zip archive",
            ),
          );
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

function hasDirectManifestInDir(dir: string): boolean {
  for (const name of RECOGNIZED_NATIVE_MANIFEST_FILES) {
    if (fs.existsSync(path.join(dir, name))) return true;
  }
  return false;
}

/**
 * Find the library root directory inside an extracted zip.
 * Looks for the shallowest `package.json`, `modelscript.json`, `package.mo`, or native manifest file.
 */
export function findLibraryRoot(dir: string, preferredName?: string): string | null {
  if (hasDirectManifestInDir(dir)) {
    return dir;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (preferredName) {
    const cleanPref = preferredName.split("/").pop()!.toLowerCase();
    const matchingDir = entries.find((e) => {
      const lower = e.name.toLowerCase();
      return lower === cleanPref || lower.startsWith(`${cleanPref} `) || lower.startsWith(`${cleanPref}-`);
    });
    if (matchingDir && hasDirectManifestInDir(path.join(dir, matchingDir.name))) {
      return path.join(dir, matchingDir.name);
    }
  }

  for (const entry of entries) {
    const subDir = path.join(dir, entry.name);
    if (hasDirectManifestInDir(subDir)) {
      return subDir;
    }
  }

  return null;
}
