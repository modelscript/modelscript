// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { parsePackageMo } from "../util/package-mo.js";

interface PublishArgs {
  path: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Publish: CommandModule<{}, PublishArgs> = {
  command: "publish <path>",
  describe: "Publish a library director or single Modelica file to the ModelScript Registry",
  builder: (yargs) => {
    return yargs.positional("path", {
      demandOption: true,
      description: "Path to the unzipped library directory (containing package.mo) or a single .mo file",
      type: "string",
    });
  },
  handler: async (args) => {
    const targetPath = path.resolve(args.path);

    if (!existsSync(targetPath)) {
      console.error(`Error: Path does not exist: ${targetPath}`);
      process.exit(1);
    }

    const stat = statSync(targetPath);
    let name: string | null = null;
    let version: string | null = null;
    const zip = new AdmZip();

    if (stat.isDirectory()) {
      const packageMoPath = path.join(targetPath, "package.mo");
      if (!existsSync(packageMoPath)) {
        console.error(`Error: Directory must contain a 'package.mo' file: ${packageMoPath}`);
        process.exit(1);
      }

      const content = readFileSync(packageMoPath, "utf-8");
      const parsed = parsePackageMo(content);

      if (!parsed.name) {
        console.error(`Error: Could not determine package name from ${packageMoPath}`);
        process.exit(1);
      }

      name = parsed.name;
      version = parsed.version || "0.0.0";

      // Zip the entire directory, retaining structure
      zip.addLocalFolder(targetPath);
    } else if (stat.isFile() && targetPath.endsWith(".mo")) {
      const content = readFileSync(targetPath, "utf-8");
      const parsed = parsePackageMo(content);

      if (!parsed.name) {
        console.error(`Error: Could not determine package name from file: ${targetPath}`);
        process.exit(1);
      }

      name = parsed.name;
      version = parsed.version || "0.0.0";

      // The API strictly checks for a root "package.mo".
      // We rename this single file to `package.mo` inside the zip archive payload.
      zip.addFile("package.mo", Buffer.from(content, "utf-8"));
    } else {
      console.error(`Error: Path must be a directory or a single .mo file`);
      process.exit(1);
    }

    console.log(`Publishing ${name}@${version}...`);

    const zipBuffer = zip.toBuffer();

    // Create FormData manually since Node 18+ has a global Request/Response/FormData
    const formData = new FormData();
    // Wrap zip buffer in a Blob for fetch API
    const blob = new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" });

    // 'file' is the field name multer expects on the API side
    formData.append("file", blob, "library.zip");

    try {
      // Connects to local dev registry; could be configurable
      const API_URL = process.env.MODELSCRIPT_API_URL || "http://localhost:3000";
      const endpoint = `${API_URL}/api/v1/libraries/${name}/${version}`;

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errMessage = res.statusText;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json = (await res.json()) as any;
          if (json.error) errMessage = json.error;
        } catch {
          // ignore parsing error if it's not JSON
        }
        console.error(`Publish failed (${res.status}): ${errMessage}`);
        process.exit(1);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      console.log(`✅ Uploaded: ${data.message || "Published successfully."}`);
      console.log(`⏳ Processing library (SVG generation + metadata extraction)...`);

      // Poll the status endpoint to show progress
      const statusUrl = `${API_URL}/api/v1/libraries/${name}/${version}/status`;
      let done = false;

      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));

        try {
          const statusRes = await fetch(statusUrl);
          if (!statusRes.ok) {
            // Status endpoint not available yet — keep waiting
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
