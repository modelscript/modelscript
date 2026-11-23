// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import yazl from "yazl";

import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";
import { indexSysmlFiles } from "./polyglot-doc-indexer.js";

function zipFolderToBuffer(dir: string, ignorePatterns: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);

    const addDirectory = (currentDir: string, zipPathPrefix = "") => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        // Simple ignore check
        const relPath = zipPathPrefix ? `${zipPathPrefix}/${entry.name}` : entry.name;

        // Check if relPath matches any ignore pattern (basic prefix/substring check)
        const shouldIgnore = ignorePatterns.some(
          (p) => relPath === p || relPath.startsWith(p + "/") || entry.name === p || entry.name.startsWith(p + "/"),
        );

        if (shouldIgnore) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          addDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          zipfile.addFile(fullPath, relPath);
        }
      }
    };

    addDirectory(dir);
    zipfile.end();
  });
}

function zipSysmlStdlibToBuffer(stdlibDir: string, version: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);

    const manifest = JSON.stringify(
      {
        name: "SysML",
        version,
        description: "OMG SysML v2 & KerML Standard Library",
        license: "OMG-SysML-2.0",
      },
      null,
      2,
    );
    zipfile.addBuffer(Buffer.from(manifest, "utf-8"), "package.json");

    if (fs.existsSync(stdlibDir)) {
      for (const entry of fs.readdirSync(stdlibDir, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          (entry.name.endsWith(".sysml") ||
            entry.name.endsWith(".kerml") ||
            entry.name === "README.md" ||
            entry.name === ".meta.json")
        ) {
          zipfile.addFile(path.join(stdlibDir, entry.name), entry.name);
        }
      }
    }
    zipfile.end();
  });
}

export async function seedExamplePackages(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  if (process.env["SEED_TOY_EXAMPLES"] !== "true") {
    return;
  }
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const examplesDirCandidates = [
    path.resolve(thisDir, "../../../../packages/examples"),
    path.resolve(thisDir, "../../../packages/examples"),
    path.resolve("packages/examples"),
  ];
  const examplesDir = examplesDirCandidates.find((p) => fs.existsSync(p));
  if (!examplesDir) return;

  const packages = fs.readdirSync(examplesDir, { withFileTypes: true });
  for (const pkgEntry of packages) {
    if (!pkgEntry.isDirectory()) continue;

    const pkgDir = path.join(examplesDir, pkgEntry.name);
    const pkgJsonPath = path.join(pkgDir, "package.json");
    const msJsonPath = path.join(pkgDir, "modelscript.json");
    const manifestPath = fs.existsSync(pkgJsonPath) ? pkgJsonPath : fs.existsSync(msJsonPath) ? msJsonPath : null;
    if (!manifestPath) continue;

    const manifestStr = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestStr) as Record<string, unknown>;
    const name = typeof manifest["name"] === "string" ? manifest["name"] : null;
    const version = typeof manifest["version"] === "string" ? manifest["version"] : null;

    if (!name || !version) {
      console.warn(`[Seed] Example ${pkgEntry.name} is missing name or version in manifest. Skipping.`);
      continue;
    }

    // Check if already seeded in both database and storage
    const existingPkg = database.getPackage(name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, version);
      if (existingVer && storage.exists(name, version)) {
        const contentHash = storage.getContentHash(name, version) ?? `sha256:${existingVer.tarball_shasum}`;
        database.saveLibraryRelease({
          libraryName: name,
          libraryVersion: version,
          contentHash,
          signature: null,
          publishedBy: null,
        });
        continue;
      }
    }

    console.log(`[Seed] Loading example package: ${name}@${version}`);

    // Parse .modelscriptignore
    const ignorePath = path.join(pkgDir, ".modelscriptignore");
    const ignorePatterns = ["node_modules", "dist", ".git"];
    if (fs.existsSync(ignorePath)) {
      const lines = fs.readFileSync(ignorePath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          ignorePatterns.push(trimmed.replace(/\/$/, ""));
        }
      }
    }

    // Zip and store
    const zipBuffer = await zipFolderToBuffer(pkgDir, ignorePatterns);
    try {
      await storage.store(name, version, zipBuffer);
    } catch (err: unknown) {
      const errObj = err as { name?: string | undefined; message?: string | undefined };
      if (errObj?.name !== "ConflictError" && !errObj?.message?.includes("already exists")) {
        throw err;
      }
    }
    const libraryPath = await storage.extractLibrary(name, version);

    // Register in database
    const { id: packageId } = database.getOrCreatePackage(name);
    const readmeText = fs.existsSync(path.join(pkgDir, "README.md"))
      ? fs.readFileSync(path.join(pkgDir, "README.md"), "utf-8")
      : null;

    const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    if (!database.getPackageVersion(packageId, version)) {
      database.storePackageVersion(
        packageId,
        version,
        `file://${pkgDir}`,
        shasum,
        null,
        zipBuffer.length,
        manifestStr,
        null,
        null,
      );
    }
    const currentExampleLatest = database.getDistTags(packageId)["latest"];
    const isLatest =
      !currentExampleLatest ||
      !semver.valid(currentExampleLatest) ||
      !semver.valid(version) ||
      semver.gte(version, currentExampleLatest);
    if (isLatest) {
      database.setDistTag(packageId, "latest", version);
      database.updatePackageMeta(packageId, {
        description: typeof manifest["description"] === "string" ? manifest["description"] : null,
        readme: readmeText,
        license: typeof manifest["license"] === "string" ? manifest["license"] : null,
      });
    }
    database.saveLibraryRelease({
      libraryName: name,
      libraryVersion: version,
      contentHash: `sha256:${sha256}`,
      signature: null,
      publishedBy: null,
    });

    // Enqueue job to process Modelica classes, SVGs, and scan artifacts
    const jobKey = `${name}@${version}`;
    const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
    jobQueue.enqueueProcess(jobKey, workerScript, {
      name,
      version,
      libraryPath,
      storageDir: storage.dataDir,
      dbDir: database.dbDir,
    });
  }
}

import { getStdlibsByPack, type StdlibEntry, type StdlibPackId } from "@modelscript/exchange/catalog";
import { MINLPLIB_CURATED_FILES } from "./minlplib-fallback.js";

async function buildMinlplibZipToBuffer(version: string, repoRoot?: string): Promise<Buffer | null> {
  const formats = ["mod", "gms", "lp", "nl"] as const;
  const zipfile = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
  });

  let added = 0;

  const limitEnv = Number(process.env["MINLPLIB_SEED_LIMIT"]);
  const limit = Number.isFinite(limitEnv) && limitEnv > 0 ? limitEnv : 150;

  // 1. Prefer local .cache/minlplib/minlplib_<fmt>.zip archives (no network requests)
  const cacheDir = process.env["MINLPLIB_CACHE_DIR"] || (repoRoot ? path.resolve(repoRoot, ".cache/minlplib") : null);
  if (cacheDir && fs.existsSync(cacheDir)) {
    const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), "minlplib-cache-"));
    try {
      const { execFileSync } = await import("node:child_process");
      for (const fmt of formats) {
        const archivePath = path.join(cacheDir, `minlplib_${fmt}.zip`);
        if (!fs.existsSync(archivePath)) continue;
        execFileSync("unzip", ["-oq", archivePath, "-d", tmpExtract]);
        const fmtDir = fs.existsSync(path.join(tmpExtract, "minlplib", fmt))
          ? path.join(tmpExtract, "minlplib", fmt)
          : path.join(tmpExtract, fmt);
        if (!fs.existsSync(fmtDir)) continue;
        const files = fs
          .readdirSync(fmtDir)
          .filter((f) => f.toLowerCase().endsWith(`.${fmt}`))
          .sort()
          .slice(0, limit);
        for (const file of files) {
          zipfile.addFile(path.join(fmtDir, file), `${fmt}/${file}`);
          added++;
        }
      }
      if (added > 0) {
        console.log(`[Seed] Packaged ${added} MINLPLib files from local cache (${cacheDir}).`);
      }
    } catch (err) {
      console.warn("[Seed] Failed to read .cache/minlplib:", err instanceof Error ? err.message : err);
    } finally {
      fs.rmSync(tmpExtract, { recursive: true, force: true });
    }
  }

  // 2. Only hit minlplib.org if local cache was not present
  if (added === 0)
    try {
      const csvRes = await fetch("https://www.minlplib.org/instancedata.csv", { signal: AbortSignal.timeout(5000) });
      if (csvRes.ok) {
        const csvText = await csvRes.text();
        const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length >= 2) {
          const splitCsv = (line: string) => {
            const out: string[] = [];
            let cur = "";
            let inQ = false;
            for (const ch of line) {
              if (ch === '"') inQ = !inQ;
              else if ((ch === "," || ch === ";") && !inQ) {
                out.push(cur.trim());
                cur = "";
              } else cur += ch;
            }
            out.push(cur.trim());
            return out;
          };

          const headers = splitCsv(lines[0]!);
          const propMap = new Map<string, Record<string, string>>();
          for (let i = 1; i < lines.length; i++) {
            const cols = splitCsv(lines[i]!);
            const name = cols[0];
            if (!name) continue;
            const props: Record<string, string> = {};
            for (let c = 1; c < headers.length; c++) {
              if (headers[c] && cols[c]) props[headers[c]!] = cols[c]!;
            }
            propMap.set(name, props);
          }

          const limitEnv = Number(process.env["MINLPLIB_SEED_LIMIT"]);
          const limit = Number.isFinite(limitEnv) && limitEnv > 0 ? limitEnv : 75;
          const names = Array.from(propMap.keys()).sort().slice(0, limit);

          const CONCURRENCY = 10;
          for (let i = 0; i < names.length; i += CONCURRENCY) {
            const batch = names.slice(i, i + CONCURRENCY);
            await Promise.all(
              batch.flatMap((modelName) =>
                formats.map(async (fmt) => {
                  try {
                    const res = await fetch(`https://www.minlplib.org/${fmt}/${modelName}.${fmt}`, {
                      signal: AbortSignal.timeout(5000),
                    });
                    if (!res.ok) return;
                    const raw = await res.text();
                    const props = propMap.get(modelName) ?? {};
                    const prefix = fmt === "lp" ? "\\ " : fmt === "gms" ? "* " : "# ";
                    const headerLines = [
                      ["Model", modelName],
                      ["Problem type", props["probtype"] ?? props["type"] ?? props["problemtype"]],
                      ["Convexity", props["convex"] ?? props["convexity"]],
                      ["Variables", props["nvars"]],
                      ["Binary variables", props["nbinvars"]],
                      ["Integer variables", props["nintvars"]],
                      ["Equations", props["ncons"] ?? props["nequ"]],
                      ["Best primal bound", props["primalbound"] ?? props["bestprimal"]],
                      ["Best dual bound", props["dualbound"] ?? props["bestdual"]],
                      ["Source", props["source"]],
                      ["Reference", `https://www.minlplib.org/${modelName}.html`],
                    ]
                      .filter(([, v]) => Boolean(v))
                      .map(([k, v]) => `${prefix}${k}: ${v}`);
                    const body = headerLines.length > 0 ? `${headerLines.join("\n")}\n\n${raw}` : raw;
                    zipfile.addBuffer(Buffer.from(body, "utf-8"), `${fmt}/${modelName}.${fmt}`);
                    added++;
                  } catch {
                    // ignore individual fetch failure
                  }
                }),
              ),
            );
          }
        }
      }
    } catch {
      // minlplib.org unreachable; fall back to built-in curated suite below
    }

  if (added === 0) {
    console.log("[Seed] minlplib.org unreachable; using built-in curated MINLPLib benchmark suite.");
    for (const f of MINLPLIB_CURATED_FILES) {
      zipfile.addBuffer(Buffer.from(f.content, "utf-8"), f.path);
      added++;
    }
  }

  zipfile.addBuffer(
    Buffer.from(
      JSON.stringify(
        {
          name: "MINLPLib",
          version,
          description: "MINLPLib mixed-integer nonlinear programming benchmark library (hybrid AMPL/GAMS/CPLEX-LP/NL)",
          license: "CC-BY-4.0",
          modelscript: { packageKind: "hybrid", defaultTab: "optimization", formats: [...formats] },
        },
        null,
        2,
      ),
      "utf-8",
    ),
    "package.json",
  );
  zipfile.addBuffer(
    Buffer.from(
      `# MINLPLib (${version})\n\nHybrid optimization benchmark package sourced from [MINLPLib](https://www.minlplib.org/) (\`.mod\`, \`.gms\`, \`.lp\`, \`.nl\`).\n\nOpen any model and switch to the **Optimization** tab to solve interactively in the browser.\n`,
      "utf-8",
    ),
    "README.md",
  );
  zipfile.end();
  return await done;
}

export async function seedPrepackagedLibraries(
  storage: LibraryStorage,
  database: LibraryDatabase,
  jobQueue: JobQueue,
): Promise<void> {
  const defaultPacks = "modelica,minlplib";
  const requestedPacks = (process.env["STDLIB_PACKS"] || defaultPacks)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const targetsMap = new Map<string, StdlibEntry>();
  for (const pack of requestedPacks) {
    const libs = getStdlibsByPack(pack as StdlibPackId | "all");
    for (const lib of libs) {
      targetsMap.set(lib.id, lib);
    }
  }

  const prepackaged = Array.from(targetsMap.values()).map((lib) => ({
    name: lib.packageName,
    version: lib.version,
    filename: lib.filename,
    description: lib.description,
    license: lib.license,
    domain: lib.domain,
    tier: lib.tier,
    minExpectedClasses: lib.minExpectedClasses ?? (lib.packageName === "Modelica" ? 6000 : 40),
    upstream: lib.upstream,
  }));

  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const workerScript = fileURLToPath(new URL(`../publish-worker${ext}`, import.meta.url));
  const repoRoot = path.resolve(path.dirname(workerScript), "../../..");

  for (const pkg of prepackaged) {
    const existingPkg = database.getPackage(pkg.name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, pkg.version);
      if (existingVer && storage.exists(pkg.name, pkg.version)) {
        const contentHash = storage.getContentHash(pkg.name, pkg.version) ?? `sha256:${existingVer.tarball_shasum}`;
        database.saveLibraryRelease({
          libraryName: pkg.name,
          libraryVersion: pkg.version,
          contentHash,
          signature: null,
          publishedBy: null,
        });

        // Backfill missing Modelica root README from indexed Modelica root class documentation if needed
        const currentLatestVer = database.getDistTags(existingPkg.id)["latest"];
        const isLatestVer = !currentLatestVer || currentLatestVer === pkg.version;
        if (pkg.name === "Modelica" && isLatestVer && !existingPkg.readme) {
          const rootModelica = database.getClass("Modelica", pkg.version, "Modelica");
          if (rootModelica?.documentation) {
            database.updatePackageMeta(existingPkg.id, {
              description: rootModelica.description ?? pkg.description,
              readme: rootModelica.documentation,
              license: pkg.license,
            });
          }
        }

        const classCount = database.getClassCount(pkg.name, pkg.version);
        const minExpectedClasses = pkg.minExpectedClasses;
        const hasSysmlRoot =
          pkg.name !== "SysML" ||
          (database.hasClass(pkg.name, pkg.version, "SysML") &&
            database.hasClass(pkg.name, pkg.version, "Parts.Part") &&
            Boolean(existingPkg.readme));
        if (classCount >= minExpectedClasses && hasSysmlRoot) {
          continue; // Already seeded and fully processed
        }

        // For SysML stdlib, refresh the zip/extracted dir from languages/sysml2/stdlib if incomplete
        if (pkg.name === "SysML") {
          const stdlibDir = path.resolve(repoRoot, "languages/sysml2/stdlib");
          if (fs.existsSync(stdlibDir)) {
            try {
              const zipBuf = await zipSysmlStdlibToBuffer(stdlibDir, pkg.version);
              const targetZipPath = path.join(storage.dataDir, "SysML", `${pkg.version}.zip`);
              fs.mkdirSync(path.dirname(targetZipPath), { recursive: true });
              fs.writeFileSync(targetZipPath, zipBuf);
              const extractedPath = storage.getExtractedPath(pkg.name, pkg.version);
              if (fs.existsSync(extractedPath)) {
                fs.rmSync(extractedPath, { recursive: true, force: true });
              }
              const libPath = await storage.extractLibrary(pkg.name, pkg.version);
              const readmePath = path.join(stdlibDir, "README.md");
              const readmeText = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : null;
              const currentLatestSysml = database.getDistTags(existingPkg.id)["latest"];
              const isLatestSysml = !currentLatestSysml || currentLatestSysml === pkg.version;
              if (isLatestSysml) {
                database.updatePackageMeta(existingPkg.id, {
                  description: pkg.description,
                  readme: readmeText,
                  license: pkg.license,
                });
              }
              const indexed = await indexSysmlFiles({
                extractedDir: libPath,
                packageName: pkg.name,
                version: pkg.version,
              });
              for (const item of indexed) {
                storage.storeSvg(pkg.name, pkg.version, item.metadata.className, item.iconSvg, item.diagramSvg);
              }
              if (indexed.length > 0) {
                database.storeClassBatch(
                  pkg.name,
                  pkg.version,
                  indexed.map((i) => i.metadata),
                );
              }
            } catch (err) {
              console.warn(`[Seed] Failed to refresh SysML stdlib:`, err);
            }
          }
        }

        // If package and version exist but classes are incomplete, re-enqueue job
        let libraryPath = storage.getExtractedPath(pkg.name, pkg.version);
        if (!fs.existsSync(libraryPath)) {
          try {
            libraryPath = await storage.extractLibrary(pkg.name, pkg.version);
          } catch (err) {
            console.warn(`[Seed] Could not extract library for ${pkg.name}@${pkg.version}:`, err);
          }
        }
        if (fs.existsSync(libraryPath)) {
          console.log(`[Seed] Re-enqueuing processing for prepackaged library: ${pkg.name}@${pkg.version}`);
          const jobKey = `${pkg.name}@${pkg.version}`;
          const isMassiveLib = pkg.name === "Modelica" || (pkg.minExpectedClasses && pkg.minExpectedClasses > 1000);
          const timeoutMs = isMassiveLib ? 40 * 60 * 1000 : 20 * 60 * 1000;
          const maxTimeoutMs = isMassiveLib ? 60 * 60 * 1000 : 35 * 60 * 1000;
          jobQueue.enqueueProcess(
            jobKey,
            workerScript,
            {
              name: pkg.name,
              version: pkg.version,
              libraryPath,
              storageDir: storage.dataDir,
              dbDir: database.dbDir,
            },
            { priority: "low", timeoutMs, maxTimeoutMs },
          );
          continue;
        }
      }
    }

    if (pkg.name === "Complex" || pkg.name === "ModelicaServices") {
      storage.ensureCompanionPackage(pkg.name, pkg.version);
    }

    const candidateZipPaths = [
      path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`),
      path.resolve(repoRoot, "scripts", pkg.filename),
      path.resolve(repoRoot, "apps/api/data/libraries", pkg.name, `${pkg.version}.zip`),
      path.resolve(repoRoot, "apps/api/data/libraries", pkg.filename),
      path.resolve(repoRoot, "modelscript_libraries", pkg.filename),
      path.resolve(repoRoot, "scripts", `${pkg.name}-${pkg.version}.lsp-bundle.zip`),
      process.env["STDLIB_STORAGE_DIR"] ? path.resolve(process.env["STDLIB_STORAGE_DIR"], pkg.filename) : null,
      process.env["STDLIB_STORAGE_DIR"]
        ? path.resolve(process.env["STDLIB_STORAGE_DIR"], pkg.name, `${pkg.version}.zip`)
        : null,
    ].filter(Boolean) as string[];

    let resolvedZipPath: string | null = null;
    let zipBuffer: Buffer | null = null;

    const stdlibDir = path.resolve(repoRoot, "languages/sysml2/stdlib");
    const existingStorageZip = path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`);
    if (pkg.name === "SysML" && fs.existsSync(stdlibDir) && !fs.existsSync(existingStorageZip)) {
      zipBuffer = await zipSysmlStdlibToBuffer(stdlibDir, pkg.version);
      resolvedZipPath = path.resolve(repoRoot, "scripts", pkg.filename);
    } else if (pkg.name === "MINLPLib" && !fs.existsSync(existingStorageZip)) {
      for (const cand of candidateZipPaths) {
        if (fs.existsSync(cand)) {
          resolvedZipPath = cand;
          zipBuffer = fs.readFileSync(cand);
          break;
        }
      }
      if (!zipBuffer) {
        console.log(`[Seed] Building MINLPLib@${pkg.version} hybrid package...`);
        zipBuffer = await buildMinlplibZipToBuffer(pkg.version, repoRoot);
        if (zipBuffer) {
          fs.mkdirSync(path.dirname(existingStorageZip), { recursive: true });
          fs.writeFileSync(existingStorageZip, zipBuffer);
          resolvedZipPath = existingStorageZip;
        }
      }
    } else {
      for (const cand of candidateZipPaths) {
        if (fs.existsSync(cand)) {
          resolvedZipPath = cand;
          zipBuffer = fs.readFileSync(cand);
          break;
        }
      }
    }

    if (!zipBuffer || !resolvedZipPath) {
      if (pkg.tier === "tier3_ondemand") {
        // Register open-source catalog package in database so it is deployed and discoverable
        const { id: packageId } = database.getOrCreatePackage(pkg.name);
        if (!database.getPackageVersion(packageId, pkg.version)) {
          database.storePackageVersion(
            packageId,
            pkg.version,
            pkg.upstream?.url || `catalog://${pkg.name}/${pkg.version}`,
            "",
            null,
            0,
            JSON.stringify({
              name: pkg.name,
              version: pkg.version,
              description: pkg.description,
              license: pkg.license,
              language: "modelica",
              modelscript: { domains: ["modelica"] },
            }),
            null,
            null,
          );
          database.setDistTag(packageId, "latest", pkg.version);
          database.updatePackageMeta(packageId, {
            description: pkg.description,
            license: pkg.license,
          });
        }
        continue;
      }
      if (pkg.upstream?.url) {
        console.log(
          `[Seed] Archive for ${pkg.name}@${pkg.version} not found locally on disk. Attempting on-the-fly download...`,
        );
        const candidateUrls = [pkg.upstream.url, pkg.upstream.fallbackUrl, ...(pkg.upstream.mirrorUrls || [])].filter(
          Boolean,
        ) as string[];

        for (const url of candidateUrls) {
          try {
            console.log(`[Seed] Fetching ${pkg.name} from ${url}...`);
            const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 100) {
                zipBuffer = buf;
                resolvedZipPath = path.resolve(storage.dataDir, pkg.name, `${pkg.version}.zip`);
                fs.mkdirSync(path.dirname(resolvedZipPath), { recursive: true });
                fs.writeFileSync(resolvedZipPath, zipBuffer);
                console.log(
                  `[Seed] Successfully downloaded and cached ${pkg.name}@${pkg.version} (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB).`,
                );
                break;
              }
            }
          } catch (fetchErr) {
            console.warn(`[Seed] Download failed from ${url}:`, fetchErr);
          }
        }
      }
    }

    if (!zipBuffer || !resolvedZipPath) {
      console.warn(`[Seed] Prepackaged library zip not found for ${pkg.name}@${pkg.version}`);
      continue;
    }

    console.log(`[Seed] Loading prepackaged library: ${pkg.name}@${pkg.version} from ${resolvedZipPath}`);

    if (pkg.name === "SysML") {
      // Ensure stale extracted directory without SysML.sysml or metadata.json is replaced
      const existingExtracted = storage.getExtractedPath(pkg.name, pkg.version);
      if (
        fs.existsSync(existingExtracted) &&
        !fs.existsSync(path.join(existingExtracted, "SysML.sysml")) &&
        !fs.existsSync(path.join(existingExtracted, "metadata.json"))
      ) {
        fs.rmSync(existingExtracted, { recursive: true, force: true });
      }
      const targetZipPath = path.join(storage.dataDir, "SysML", `${pkg.version}.zip`);
      if (resolvedZipPath !== targetZipPath) {
        fs.mkdirSync(path.dirname(targetZipPath), { recursive: true });
        fs.writeFileSync(targetZipPath, zipBuffer);
      }
    } else {
      try {
        await storage.store(pkg.name, pkg.version, zipBuffer);
      } catch (err: unknown) {
        const errObj = err as { name?: string | undefined; message?: string | undefined };
        if (errObj?.name !== "ConflictError" && !errObj?.message?.includes("already exists")) {
          throw err;
        }
      }
    }
    const libraryPath = await storage.extractLibrary(pkg.name, pkg.version);

    const { id: packageId } = database.getOrCreatePackage(pkg.name);
    const readmeCandidate = path.join(libraryPath, "README.md");
    const readmeText = fs.existsSync(readmeCandidate) ? fs.readFileSync(readmeCandidate, "utf-8") : null;

    let isPreIndexed = false;
    const metadataCandidate = path.join(libraryPath, "metadata.json");
    const iconsCandidate = path.join(libraryPath, "icons.json");
    const indexCandidate = path.join(libraryPath, "index.json");

    if (fs.existsSync(metadataCandidate)) {
      try {
        const metaStr = fs.readFileSync(metadataCandidate, "utf-8");
        const parsed = JSON.parse(metaStr);
        const classes = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.classes) ? parsed.classes : [];
        if (classes.length > 0) {
          database.storeClassBatch(pkg.name, pkg.version, classes);
          isPreIndexed = true;
          console.log(
            `[Seed] Fast-ingested ${classes.length} pre-indexed classes for ${pkg.name}@${pkg.version} in O(1) time.`,
          );
        }
      } catch (metaErr) {
        console.warn(`[Seed] Warning parsing metadata.json for ${pkg.name}@${pkg.version}:`, metaErr);
      }
    }

    if (fs.existsSync(iconsCandidate)) {
      try {
        const iconsStr = fs.readFileSync(iconsCandidate, "utf-8");
        const icons = JSON.parse(iconsStr) as Record<string, string>;
        for (const [clsName, svg] of Object.entries(icons)) {
          if (typeof svg === "string") {
            storage.storeSvg(pkg.name, pkg.version, clsName, svg, null);
          }
        }
      } catch (iconErr) {
        console.warn(`[Seed] Warning parsing icons.json for ${pkg.name}@${pkg.version}:`, iconErr);
      }
    }

    if (pkg.name === "SysML" && !isPreIndexed) {
      try {
        const indexed = await indexSysmlFiles({
          extractedDir: libraryPath,
          packageName: pkg.name,
          version: pkg.version,
        });
        for (const item of indexed) {
          storage.storeSvg(pkg.name, pkg.version, item.metadata.className, item.iconSvg, item.diagramSvg);
        }
        if (indexed.length > 0) {
          database.storeClassBatch(
            pkg.name,
            pkg.version,
            indexed.map((i) => i.metadata),
          );
        }
      } catch (err) {
        console.warn(`[Seed] Synchronous SysML indexing warning:`, err);
      }
    }

    const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    const manifestObj = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      modelscript: {
        domains: pkg.domain ? [pkg.domain] : [],
        tier: pkg.tier,
      },
    };
    if (!database.getPackageVersion(packageId, pkg.version)) {
      database.storePackageVersion(
        packageId,
        pkg.version,
        `file://${resolvedZipPath}`,
        shasum,
        null,
        zipBuffer.length,
        JSON.stringify(manifestObj),
        null,
        null,
      );
    }
    const currentLatest = database.getDistTags(packageId)["latest"];
    const isLatest =
      !currentLatest ||
      !semver.valid(currentLatest) ||
      !semver.valid(pkg.version) ||
      semver.gte(pkg.version, currentLatest);
    if (isLatest) {
      database.setDistTag(packageId, "latest", pkg.version);
      database.updatePackageMeta(packageId, {
        description: pkg.description,
        readme: readmeText,
        license: pkg.license,
      });
    }
    database.saveLibraryRelease({
      libraryName: pkg.name,
      libraryVersion: pkg.version,
      contentHash: `sha256:${sha256}`,
      signature: null,
      publishedBy: null,
    });

    if (!isPreIndexed && !fs.existsSync(indexCandidate)) {
      const jobKey = `${pkg.name}@${pkg.version}`;
      const isMassiveLib = pkg.name === "Modelica" || (pkg.minExpectedClasses && pkg.minExpectedClasses > 1000);
      const timeoutMs = isMassiveLib ? 40 * 60 * 1000 : 20 * 60 * 1000;
      const maxTimeoutMs = isMassiveLib ? 60 * 60 * 1000 : 35 * 60 * 1000;
      jobQueue.enqueueProcess(
        jobKey,
        workerScript,
        {
          name: pkg.name,
          version: pkg.version,
          libraryPath,
          storageDir: storage.dataDir,
          dbDir: database.dbDir,
        },
        { priority: "low", timeoutMs, maxTimeoutMs },
      );
    } else {
      console.log(`[Seed] Skipped background worker queue for ${pkg.name}@${pkg.version} (already pre-indexed).`);
    }
  }

  await seedCleanroomStdlibs(storage, database, repoRoot);
}

function parseCleanroomManifest(yamlText: string): {
  name: string;
  version: string;
  license: string;
  description: string;
  language: string;
} | null {
  const unquote = (v: string): string => {
    const trimmed = v.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
    return trimmed;
  };
  let name = "";
  let version = "0.1.0";
  let license = "AGPL-3.0-or-later";
  let description = "";
  let language = "";
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = unquote(line.slice(colon + 1));
    if (key === "name") name = val;
    else if (key === "version" && val) version = val;
    else if (key === "license" && val) license = val;
    else if (key === "description") description = val;
    else if (key === "language") language = val;
  }
  if (!name) return null;
  return { name, version, license, description, language: language || "modelica" };
}

/**
 * Publishes all built-in cleanroom standard libraries (`languages/<lang>/assets/<lang>-std-lib`)
 * to the local package registry so they are available by default in flagship deployments.
 */
export async function seedCleanroomStdlibs(
  storage: LibraryStorage,
  database: LibraryDatabase,
  repoRoot: string,
): Promise<number> {
  const languagesDir = path.join(repoRoot, "languages");
  if (!fs.existsSync(languagesDir)) return 0;

  const langEntries = fs.readdirSync(languagesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  let AdmZipCtor: typeof import("adm-zip") | null = null;
  let publishedCount = 0;

  for (const entry of langEntries) {
    const stdLibDir = path.join(languagesDir, entry.name, "assets", `${entry.name}-std-lib`);
    const manifestPath = path.join(stdLibDir, "modelscript.yaml");
    const symbolsPath = path.join(stdLibDir, "dist", "symbols.json");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(symbolsPath)) continue;

    const meta = parseCleanroomManifest(fs.readFileSync(manifestPath, "utf-8"));
    if (!meta) continue;

    const existingPkg = database.getPackage(meta.name);
    if (existingPkg) {
      const existingVer = database.getPackageVersion(existingPkg.id, meta.version);
      if (
        existingVer &&
        storage.exists(meta.name, meta.version) &&
        database.getClassCount(meta.name, meta.version) > 0
      ) {
        continue;
      }
    }

    try {
      if (!AdmZipCtor) {
        AdmZipCtor = (await import("adm-zip")).default;
      }
      const zip = new AdmZipCtor();
      zip.addLocalFolder(stdLibDir, "", (filePath) => !filePath.startsWith(".cache"));
      const zipBuffer = zip.toBuffer();

      try {
        await storage.store(meta.name, meta.version, zipBuffer);
      } catch (err: unknown) {
        const errObj = err as { name?: string | undefined; message?: string | undefined };
        if (errObj?.name !== "ConflictError" && !errObj?.message?.includes("already exists")) {
          throw err;
        }
      }
      await storage.extractLibrary(meta.name, meta.version);

      const { id: packageId } = database.getOrCreatePackage(meta.name);
      const shasum = crypto.createHash("sha1").update(zipBuffer).digest("hex");
      const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
      const manifestObj = {
        name: meta.name,
        version: meta.version,
        description: meta.description,
        license: meta.license,
        language: meta.language,
        modelscript: {
          category: "library",
          language: meta.language,
          domains: [meta.language],
        },
      };

      if (!database.getPackageVersion(packageId, meta.version)) {
        database.storePackageVersion(
          packageId,
          meta.version,
          `cleanroom://${meta.name}/${meta.version}`,
          shasum,
          null,
          zipBuffer.length,
          JSON.stringify(manifestObj),
          null,
          null,
        );
      }
      database.setDistTag(packageId, "latest", meta.version);
      database.updatePackageMeta(packageId, {
        description: meta.description,
        license: meta.license,
      });
      database.saveLibraryRelease({
        libraryName: meta.name,
        libraryVersion: meta.version,
        contentHash: `sha256:${sha256}`,
        signature: null,
        publishedBy: null,
      });

      const symbols = JSON.parse(fs.readFileSync(symbolsPath, "utf-8")) as Array<{
        name: string;
        kind?: string;
        namePath?: string;
        inherits?: string[];
        metadata?: {
          label?: string;
          description?: string;
          parameters?: Array<{ key: string; type?: string; defaultValue?: unknown; description?: string }>;
        };
      }>;
      const diagramsPath = path.join(stdLibDir, "dist", "diagrams.json");
      const diagramMap = new Map<string, string>();
      if (fs.existsSync(diagramsPath)) {
        const diagrams = JSON.parse(fs.readFileSync(diagramsPath, "utf-8")) as Array<{
          namePath?: string;
          svg?: string;
        }>;
        for (const d of diagrams) {
          if (d.namePath && d.svg) diagramMap.set(d.namePath, d.svg);
        }
      }

      const classes = symbols.map((sym) => {
        const className = sym.namePath || sym.name;
        const svg = diagramMap.get(className) ?? null;
        if (svg) {
          storage.storeSvg(meta.name, meta.version, className, svg, svg);
        }
        return {
          className,
          classKind: (sym.kind || "model").toLowerCase(),
          description: sym.metadata?.label || sym.metadata?.description || null,
          documentation: sym.metadata?.description || null,
          baseClasses: Array.isArray(sym.inherits) ? sym.inherits : [],
          components: Array.isArray(sym.metadata?.parameters)
            ? sym.metadata.parameters.map((p) => ({
                name: p.key,
                typeName: p.type || "Real",
                description: p.description || null,
                causality: null,
                variability: "parameter",
                modifiers: p.defaultValue !== undefined ? [{ name: "default", value: String(p.defaultValue) }] : [],
              }))
            : [],
        };
      });

      if (classes.length > 0) {
        database.storeClassBatch(meta.name, meta.version, classes);
      }
      publishedCount++;
    } catch (err) {
      console.warn(`[Seed] Failed to publish cleanroom library ${meta.name}:`, err);
    }
  }

  if (publishedCount > 0) {
    console.log(`[Seed] Published ${publishedCount} cleanroom standard libraries to package registry.`);
  }
  return publishedCount;
}
