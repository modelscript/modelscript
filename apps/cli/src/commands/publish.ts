// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { requireToken } from "../util/auth.js";
import {
  buildPackageZip,
  collectPackageFiles,
  formatBytes,
  validatePackageManifest,
  type PackageFileEntry,
} from "../util/package-files.js";
import { parsePackageMo } from "../util/package-mo.js";
import { computePackageContentHash } from "../util/package-verify.js";

interface PublishArgs {
  path: string;
  signature?: string;
  dryRun?: boolean;
  tag?: string;
  noVerify?: boolean;
}

export const Publish: CommandModule<{}, PublishArgs> = {
  command: "publish <path>",
  describe: "Publish a library directory or single Modelica file to the ModelScript Registry",
  builder: ((yargs: any) => {
    return yargs
      .positional("path", {
        demandOption: true,
        description: "Path to the unzipped library directory (containing package.mo) or a single .mo file",
        type: "string",
      })
      .option("signature", {
        description: "Cryptographic detached signature for supply chain verification",
        type: "string",
      })
      .option("dry-run", {
        alias: "d",
        description: "Report files and archive metadata without publishing to the registry",
        type: "boolean",
        default: false,
      })
      .option("tag", {
        alias: "t",
        description: "Registers the published package with the given dist-tag",
        type: "string",
        default: "latest",
      })
      .option("no-verify", {
        description: "Skip pre-flight syntax and manifest verification",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, PublishArgs>["builder"],
  handler: async (args) => {
    const targetPath = path.resolve(args.path);

    if (!existsSync(targetPath)) {
      console.error(`Error: Path does not exist: ${targetPath}`);
      process.exit(1);
    }

    const stat = statSync(targetPath);
    let name: string | null = null;
    let version: string | null = null;
    let zip: AdmZip;
    let files: PackageFileEntry[] = [];

    if (stat.isDirectory()) {
      const packageJsonPath = path.join(targetPath, "package.json");
      const packageMoPath = path.join(targetPath, "package.mo");

      if (existsSync(packageJsonPath)) {
        try {
          const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
          if (!parsed.name) {
            console.error(`Error: 'name' field is missing in ${packageJsonPath}`);
            process.exit(1);
          }
          name = parsed.name;
          version = parsed.version || "0.0.0";
        } catch (err) {
          console.error(`Error: Failed to parse ${packageJsonPath}: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      } else if (existsSync(packageMoPath)) {
        const content = readFileSync(packageMoPath, "utf-8");
        const parsed = parsePackageMo(content);

        if (!parsed.name) {
          console.error(`Error: Could not determine package name from ${packageMoPath}`);
          process.exit(1);
        }

        name = parsed.name;
        version = parsed.version || "0.0.0";
      } else {
        console.error(`Error: Directory must contain either a 'package.json' or 'package.mo' file: ${targetPath}`);
        process.exit(1);
      }

      files = collectPackageFiles(targetPath);
      zip = buildPackageZip(files);
    } else if (stat.isFile() && targetPath.endsWith(".mo")) {
      const content = readFileSync(targetPath, "utf-8");
      const parsed = parsePackageMo(content);

      if (!parsed.name) {
        console.error(`Error: Could not determine package name from file: ${targetPath}`);
        process.exit(1);
      }

      name = parsed.name;
      version = parsed.version || "0.0.0";

      zip = new AdmZip();
      zip.addFile("package.mo", Buffer.from(content, "utf-8"));
      files = [{ relPath: "package.mo", fullPath: targetPath, size: stat.size }];
    } else {
      console.error(`Error: Path must be a directory or a single .mo file`);
      process.exit(1);
    }

    if (!args.noVerify) {
      const validation = validatePackageManifest(name!, version!, stat.isDirectory() ? targetPath : undefined);
      if (!validation.valid) {
        console.error(`Pre-publish verification failed:\n  - ${validation.errors.join("\n  - ")}`);
        process.exit(1);
      }
    }

    const zipBuffer = zip.toBuffer();
    const contentHash = computePackageContentHash(zipBuffer);
    const totalUncompressedBytes = files.reduce((acc, f) => acc + f.size, 0);

    if (args.dryRun) {
      console.log(`📦 Packaging ${name}@${version}`);
      for (let i = 0; i < files.length; i++) {
        const prefix = i === files.length - 1 ? "└── " : "├── ";
        console.log(`${prefix}${files[i]!.relPath} (${formatBytes(files[i]!.size)})`);
      }
      console.log(`\nTarball Details:`);
      console.log(`- Total Files: ${files.length}`);
      console.log(`- Uncompressed Size: ${formatBytes(totalUncompressedBytes)}`);
      console.log(`- Archive Size: ${formatBytes(zipBuffer.length)}`);
      console.log(`- Content Hash (SHA-256): ${contentHash}`);
      console.log(`- Dist-Tag: ${args.tag || "latest"}`);
      console.log(`\nNotice: Dry run complete. No network requests made.`);
      return;
    }

    console.log(`Publishing ${name}@${version} (tag: ${args.tag || "latest"})...`);

    const token = requireToken();
    console.log(`Content Hash (SHA-256): ${contentHash}`);

    // Create FormData manually since Node 18+ has a global Request/Response/FormData
    const formData = new FormData();
    // Wrap zip buffer in a Blob for fetch API
    const blob = new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" });

    // 'file' is the field name multer expects on the API side
    formData.append("file", blob, "library.zip");
    formData.append("contentHash", contentHash);
    formData.append("tag", args.tag || "latest");
    if (args.signature) {
      formData.append("signature", args.signature);
    }

    try {
      // Connects to local dev registry; could be configurable
      const API_URL = process.env.MODELSCRIPT_API_URL || "http://localhost:3000";
      const endpoint = `${API_URL}/api/v1/libraries/${name}/${version}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "X-Content-SHA256": contentHash,
      };
      if (args.signature) {
        headers["X-Package-Signature"] = args.signature;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
        headers,
      });

      if (!res.ok) {
        let errMessage = res.statusText;
        try {
          const json = (await res.json()) as any;
          if (json.error) errMessage = json.error;
        } catch {
          // ignore parsing error if it's not JSON
        }
        console.error(`Publish failed (${res.status}): ${errMessage}`);
        process.exit(1);
      }

      const data = (await res.json()) as any;
      console.log(`✅ Uploaded: ${data.message || "Published successfully."}`);
      console.log(`⏳ Processing library (SVG generation + metadata extraction)...`);

      // Poll the status endpoint to show progress
      const statusUrl = `${API_URL}/api/v1/libraries/${name}/${version}/status`;
      let done = false;

      const MAX_POLL_ATTEMPTS = 150; // 5 minutes max
      let pollAttempts = 0;

      while (!done) {
        pollAttempts++;
        if (pollAttempts > MAX_POLL_ATTEMPTS) {
          process.stdout.write(`\r`);
          console.error(`\n❌ Processing timed out after 5 minutes.`);
          process.exit(1);
        }

        await new Promise((r) => setTimeout(r, 2000));

        try {
          const statusRes = await fetch(statusUrl);
          if (!statusRes.ok) {
            // Status endpoint not available yet — keep waiting
            continue;
          }

          const status = (await statusRes.json()) as any;
          const classesProcessed = status.classesProcessed ?? 0;

          switch (status.status) {
            case "pending":
              process.stdout.write(`\r⏳ Waiting in queue...`);
              break;
            case "processing":
              process.stdout.write(`\r⏳ Processing... ${classesProcessed} classes processed`);
              break;
            case "completed":
              process.stdout.write(`\r`);
              console.log(`✅ Processing complete — ${classesProcessed} classes processed.`);
              done = true;
              break;
            case "failed":
              process.stdout.write(`\r`);
              console.error(`❌ Processing failed: ${status.error || "Unknown error"}`);
              done = true;
              process.exit(1);
              break;
          }
        } catch {
          // Network error during polling — keep trying
        }
      }
    } catch (e) {
      console.error(`Error connecting to registry: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
