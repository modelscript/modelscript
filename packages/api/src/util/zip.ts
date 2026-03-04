// SPDX-License-Identifier: AGPL-3.0-or-later

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
