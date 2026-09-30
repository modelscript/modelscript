// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import yauzl from "yauzl";

export interface PackageScanResult {
  valid: boolean;
  totalFiles: number;
  totalUncompressedBytes: number;
  quarantineReason?: string | undefined;
  violations: string[];
}

export const SCAN_LIMITS = {
  MAX_FILES: 50_000,
  MAX_TOTAL_UNCOMPRESSED_BYTES: 250 * 1024 * 1024, // 250 MB
  MAX_COMPRESSION_RATIO: 100,
  MIN_BYTES_FOR_RATIO_CHECK: 10 * 1024 * 1024, // 10 MB
};

export const PROHIBITED_FILE_EXTENSIONS = new Set<string>([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".vbs",
  ".msi",
  ".elf",
  ".com",
  ".scr",
]);

export const PROHIBITED_MODELICA_CALLS = [
  { pattern: /\b(system|popen|exec|fork|dlopen)\s*\(/i, name: "Dangerous native process/library invocation" },
];

/**
 * Performs automated security scanning on an incoming Modelica package zip archive:
 * 1. Zip Slip path traversal detection
 * 2. Zip bomb / resource exhaustion defense
 * 3. Binary / executable screening
 * 4. Modelica AST / source code static screening for malicious external C system calls
 */
export async function scanPackageArchive(buffer: Buffer): Promise<PackageScanResult> {
  const violations: string[] = [];
  let totalFiles = 0;
  let totalUncompressedBytes = 0;

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        resolve({
          valid: false,
          totalFiles: 0,
          totalUncompressedBytes: 0,
          quarantineReason: "Archive corruption or unreadable zip structure",
          violations: ["CORRUPT_ZIP_ARCHIVE"],
        });
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        totalFiles += 1;
        totalUncompressedBytes += entry.uncompressedSize;

        const normalizedName = entry.fileName.replace(/\\/g, "/");

        // 1. Zip Slip check
        if (
          normalizedName.includes("..") ||
          normalizedName.startsWith("/") ||
          /^[a-zA-Z]:/.test(normalizedName) ||
          path.normalize(normalizedName).startsWith("..")
        ) {
          violations.push(`Zip Slip path traversal attempt detected in entry: "${entry.fileName}"`);
        }

        // 2. Zip Bomb thresholds
        if (totalFiles > SCAN_LIMITS.MAX_FILES) {
          violations.push(`Archive exceeds maximum allowed file count (${SCAN_LIMITS.MAX_FILES.toLocaleString()})`);
        }

        if (totalUncompressedBytes > SCAN_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
          violations.push(
            `Archive exceeds maximum uncompressed size (${(SCAN_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024).toFixed(0)} MB)`,
          );
        }

        // 3. Prohibited Executables & Native Binaries
        const ext = path.extname(normalizedName).toLowerCase();
        if (PROHIBITED_FILE_EXTENSIONS.has(ext)) {
          violations.push(`Prohibited executable or binary file found: "${entry.fileName}" (${ext})`);
        }

        // 4. Modelica static scanning for external process execution
        if (ext === ".mo" && !entry.fileName.endsWith("/")) {
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr || !readStream) {
              zipfile.readEntry();
              return;
            }

            const chunks: Buffer[] = [];
            readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
            readStream.on("end", () => {
              const code = Buffer.concat(chunks).toString("utf-8");
              for (const { pattern, name } of PROHIBITED_MODELICA_CALLS) {
                if (pattern.test(code)) {
                  violations.push(`Malicious/prohibited construct detected in "${entry.fileName}": ${name}`);
                }
              }
              zipfile.readEntry();
            });
            readStream.on("error", () => {
              zipfile.readEntry();
            });
          });
          return;
        }

        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        // Compression ratio check
        if (
          totalUncompressedBytes > SCAN_LIMITS.MIN_BYTES_FOR_RATIO_CHECK &&
          totalUncompressedBytes / (buffer.length || 1) > SCAN_LIMITS.MAX_COMPRESSION_RATIO
        ) {
          violations.push("Abnormal compression ratio detected (potential Zip Bomb attack)");
        }

        const valid = violations.length === 0;
        resolve({
          valid,
          totalFiles,
          totalUncompressedBytes,
          quarantineReason: valid ? undefined : violations.join("; "),
          violations,
        });
      });

      zipfile.on("error", (zipErr) => {
        const msg = zipErr?.message || "Unknown zip reading error";
        const violation = msg.includes("invalid relative path") ? `Zip Slip path traversal attempt: ${msg}` : msg;
        resolve({
          valid: false,
          totalFiles,
          totalUncompressedBytes,
          quarantineReason: violation,
          violations: [violation],
        });
      });
    });
  });
}
