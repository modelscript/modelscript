// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { getApiUrl, getToken, requireToken } from "../util/auth.js";
import {
  buildPackageZip,
  collectPackageFiles,
  formatBytes,
  validatePackageManifest,
  type PackageFileEntry,
} from "../util/package-files.js";
import { parsePackageMo } from "../util/package-mo.js";
import { computePackageContentHash } from "../util/package-verify.js";
import { signPackageContentHash } from "../util/signing.js";

interface PublishArgs {
  path: string;
  signature?: string | undefined;
  sign?: boolean | undefined;
  key?: string | undefined;
  pubkey?: string | undefined;
  oidc?: boolean | undefined;
  oidcToken?: string | undefined;
  dryRun?: boolean | undefined;
  tag?: string | undefined;
  noVerify?: boolean | undefined;
}

export const Publish: CommandModule<{}, PublishArgs> = {
  command: "publish <path>",
  describe: "Publish a library directory or single Modelica file to the Ansatz Package Registry",
  builder: ((yargs: Argv) => {
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
      .option("sign", {
        description: "Sign the package using an Ed25519 private key",
        type: "boolean",
        default: false,
      })
      .option("key", {
        description: "Path to Ed25519 private key used to sign the package release",
        type: "string",
      })
      .option("pubkey", {
        description: "Path to Ed25519 public key corresponding to the signing key",
        type: "string",
      })
      .option("oidc", {
        description: "Enable keyless OIDC signing from ambient CI/CD environment (GitHub Actions, GitLab CI)",
        type: "boolean",
        default: false,
      })
      .option("oidc-token", {
        description: "Explicit OIDC ID token JWT for keyless supply chain attestation",
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

    let signature = args.signature;
    let explicitPublicKey = args.pubkey;

    if (!signature && (args.sign || args.key)) {
      const candidatePaths = [
        args.key,
        process.env["MODELSCRIPT_SIGNING_KEY"],
        path.join(os.homedir(), ".modelscript", "signing.key"),
        path.join(os.homedir(), ".ssh", "id_ed25519_modelscript"),
        path.join(os.homedir(), ".ssh", "id_ed25519"),
      ].filter((p): p is string => Boolean(p && existsSync(p)));

      const resolvedKeyPath = candidatePaths[0];
      if (resolvedKeyPath) {
        try {
          const signed = signPackageContentHash(contentHash, resolvedKeyPath);
          signature = signed.signature;
          if (!explicitPublicKey && signed.publicKeySpki) {
            explicitPublicKey = signed.publicKeySpki;
          }
          console.log(`🔏 Signed package release with key: ${resolvedKeyPath}`);
        } catch (err) {
          console.error(
            `Failed to sign package with ${resolvedKeyPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      } else if (args.key) {
        console.error(`Error: Signing key not found at ${args.key}`);
        process.exit(1);
      }
    }

    // Ambient / Explicit OIDC discovery for Keyless signing
    let oidcToken = args.oidcToken || process.env["MODELSCRIPT_OIDC_TOKEN"] || process.env["OIDC_ID_TOKEN"];

    if (
      !oidcToken &&
      (args.oidc ||
        process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] ||
        process.env["CI_JOB_JWT_V2"] ||
        process.env["CI_JOB_JWT"])
    ) {
      if (process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] && process.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) {
        try {
          const audience = encodeURIComponent("modelscript-registry");
          const idTokenUrl = `${process.env["ACTIONS_ID_TOKEN_REQUEST_URL"]}&audience=${audience}`;
          const oidcRes = await fetch(idTokenUrl, {
            headers: { Authorization: `bearer ${process.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]}` },
          });
          if (oidcRes.ok) {
            const idTokenData = (await oidcRes.json()) as { value?: string };
            if (idTokenData.value) {
              oidcToken = idTokenData.value;
              console.log(`🔐 Acquired ambient GitHub Actions OIDC ID token`);
            }
          }
        } catch {
          // ignore
        }
      } else if (process.env["CI_JOB_JWT_V2"] || process.env["CI_JOB_JWT"]) {
        oidcToken = process.env["CI_JOB_JWT_V2"] || process.env["CI_JOB_JWT"];
        console.log(`🔐 Acquired ambient GitLab CI OIDC ID token`);
      }
    }

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
      if (signature) {
        console.log(`- Signature: ${signature.slice(0, 32)}...`);
      }
      if (oidcToken) {
        console.log(`- Keyless OIDC Attestation: Active (verified ambient runner identity)`);
      }
      console.log(`- Dist-Tag: ${args.tag || "latest"}`);
      console.log(`\nNotice: Dry run complete. No network requests made.`);
      return;
    }

    console.log(`Publishing ${name}@${version} (tag: ${args.tag || "latest"})...`);

    let token = getToken();
    if (!token && !oidcToken) {
      token = requireToken();
    }
    console.log(`Content Hash (SHA-256): ${contentHash}`);

    // Create FormData manually since Node 18+ has a global Request/Response/FormData
    const formData = new FormData();
    // Wrap zip buffer in a Blob for fetch API
    const blob = new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" });

    // 'file' is the field name multer expects on the API side
    formData.append("file", blob, "library.zip");
    formData.append("contentHash", contentHash);
    formData.append("tag", args.tag || "latest");
    if (signature) {
      formData.append("signature", signature);
    }
    if (explicitPublicKey) {
      formData.append("publicKey", explicitPublicKey);
    }
    if (oidcToken) {
      formData.append("oidcToken", oidcToken);
    }

    try {
      const API_URL = getApiUrl();
      const endpoint = `${API_URL}/api/v1/libraries/${name}/${version}`;

      const headers: Record<string, string> = {
        "X-Content-SHA256": contentHash,
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else if (oidcToken) {
        headers["Authorization"] = `Bearer ${oidcToken}`;
      }
      if (oidcToken) {
        headers["X-Package-OIDC-Token"] = oidcToken;
      }
      if (signature) {
        headers["X-Package-Signature"] = signature;
      }
      if (explicitPublicKey) {
        headers["X-Package-Public-Key"] = explicitPublicKey;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
        headers,
      });

      if (!res.ok) {
        let errMessage = res.statusText;
        try {
          const json = (await res.json()) as { error?: string | undefined };
          if (json.error) errMessage = json.error;
        } catch {
          // ignore parsing error if it's not JSON
        }
        console.error(`Publish failed (${res.status}): ${errMessage}`);
        process.exit(1);
      }

      const data = (await res.json()) as { message?: string | undefined };
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

          const status = (await statusRes.json()) as {
            status?: string | undefined;
            classesProcessed?: number | undefined;
            error?: string | undefined;
          };
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
