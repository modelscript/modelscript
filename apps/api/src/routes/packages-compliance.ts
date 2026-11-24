// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  type CanonicalWorkspaceManifest,
  type DataPackageResourceDescriptor,
  ManifestLensEngine,
  parseDataPackageResources,
} from "@modelscript/exchange";
import type { LibraryDatabase } from "../database.js";
import type { LibraryStorage } from "../storage.js";
import { getPackageVersionResources, resolveDataPackageLockfile } from "../util/datapackage-indexer.js";
import {
  formatCycloneDxVulnerabilities,
  formatSpdxSecurityRefs,
  scanDependenciesVulnerabilities,
  scanPackageVulnerabilities,
} from "../util/osv-scanner.js";
import { generateSlsaProvenance } from "../util/slsa-provenance.js";

export function extractPkgAndVersion(req: Request): { name: string; version: string } {
  if (req.params["scope"] && req.params["name"]) {
    const scope = Array.isArray(req.params["scope"]) ? req.params["scope"][0] : req.params["scope"];
    const baseName = Array.isArray(req.params["name"]) ? req.params["name"][0] : req.params["name"];
    const version = Array.isArray(req.params["version"]) ? req.params["version"][0] : req.params["version"];
    return { name: `${scope}/${baseName}`, version: version ?? "" };
  }
  const rawName = Array.isArray(req.params["name"]) ? req.params["name"][0] : req.params["name"];
  const rawVersion = Array.isArray(req.params["version"]) ? req.params["version"][0] : req.params["version"];
  return { name: decodeURIComponent(rawName ?? ""), version: rawVersion ?? "" };
}

export function isScopeInvalid(req: Request): boolean {
  if (req.params["scope"] && !String(req.params["scope"]).startsWith("@")) {
    return true;
  }
  const versionStr = req.params["version"] ? String(req.params["version"]) : "";
  if (
    versionStr === "download" ||
    versionStr === "salsa-index.db" ||
    versionStr === "index.msidx" ||
    versionStr === "memos" ||
    versionStr === "lsp-bundle" ||
    versionStr === "lockfile"
  ) {
    return true;
  }
  return false;
}

export async function resolveCanonicalManifest(
  storage: LibraryStorage,
  database: LibraryDatabase,
  name: string,
  version: string,
): Promise<{ manifest: CanonicalWorkspaceManifest; extractedDir: string | null }> {
  let extractedDir: string | null = null;
  try {
    extractedDir = await storage.extractLibrary(name, version);
  } catch {
    const p = storage.getExtractedPath(name, version);
    if (fs.existsSync(p)) extractedDir = p;
  }

  const dbResources = getPackageVersionResources(database, name, version);
  const pkgRecord = database.getPackage(name);
  const verRow = pkgRecord ? database.getPackageVersion(pkgRecord.id, version) : undefined;
  let storedDeps: Record<string, string> | undefined;
  let storedResources: DataPackageResourceDescriptor[] = [];
  let storedProfile: string | undefined;

  if (verRow?.manifest) {
    try {
      const parsed = JSON.parse(verRow.manifest) as Record<string, unknown>;
      const msx =
        parsed["modelscript"] && typeof parsed["modelscript"] === "object"
          ? (parsed["modelscript"] as Record<string, unknown>)
          : undefined;
      if (parsed["dependencies"] && typeof parsed["dependencies"] === "object") {
        storedDeps = parsed["dependencies"] as Record<string, string>;
      }
      storedProfile =
        typeof parsed["profile"] === "string"
          ? parsed["profile"]
          : typeof msx?.["profile"] === "string"
            ? msx["profile"]
            : undefined;
      storedResources = parseDataPackageResources(parsed["resources"] ?? msx?.["resources"]);
    } catch {
      // ignore
    }
  }

  const mergeResources = (base?: DataPackageResourceDescriptor[]): DataPackageResourceDescriptor[] | undefined => {
    const map = new Map<string, DataPackageResourceDescriptor>();
    for (const r of base ?? []) map.set(r.path, r);
    for (const r of storedResources) {
      if (!map.has(r.path)) map.set(r.path, r);
    }
    for (const r of dbResources) {
      const prev = map.get(r.path);
      if (prev) {
        map.set(r.path, {
          ...r,
          ...prev,
          hash: prev.hash ?? r.hash,
          bytes: prev.bytes ?? r.bytes,
          rowCount: prev.rowCount ?? r.rowCount,
          schema: prev.schema ?? r.schema,
        });
      } else {
        map.set(r.path, r);
      }
    }
    return map.size > 0 ? Array.from(map.values()) : undefined;
  };

  // 1. Look for modelscript.json or datapackage.json in extracted dir
  if (extractedDir) {
    const dpJsonPath = path.join(extractedDir, "datapackage.json");
    if (fs.existsSync(dpJsonPath)) {
      try {
        const dpManifest = ManifestLensEngine.parseFromDataPackageJson(fs.readFileSync(dpJsonPath, "utf-8"));
        dpManifest.resources = mergeResources(dpManifest.resources);
        dpManifest.dependencies = dpManifest.dependencies ?? storedDeps;
        return { manifest: dpManifest, extractedDir };
      } catch {
        // Fall through
      }
    }

    const msJsonPath = path.join(extractedDir, "modelscript.json");
    if (fs.existsSync(msJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(msJsonPath, "utf-8")) as CanonicalWorkspaceManifest;
        parsed.resources = mergeResources(parsed.resources);
        parsed.dependencies = parsed.dependencies ?? storedDeps;
        parsed.profile = parsed.profile ?? storedProfile;
        return { manifest: parsed, extractedDir };
      } catch {
        // Fall through
      }
    }

    const okhJsonPath = path.join(extractedDir, "okh.json");
    if (fs.existsSync(okhJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(okhJsonPath, "utf-8"));
        return {
          manifest: {
            globalAssetId: parsed.globalAssetId ?? `urn:modelscript:${name}`,
            idShort: parsed.name ?? name,
            title: parsed.title ?? name,
            version: parsed.version ?? version,
            description: parsed.description,
            license: parsed.license,
            bom: Array.isArray(parsed.bom) ? parsed.bom : undefined,
            makingInstructions: parsed["making-instructions"],
            resources: mergeResources(),
            dependencies: storedDeps,
          },
          extractedDir,
        };
      } catch {
        // Fall through
      }
    }

    const pkgJsonPath = path.join(extractedDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const scope = parsed.name?.startsWith("@") ? parsed.name.split("/")[0] : undefined;
        const idShort = parsed.name?.startsWith("@") ? parsed.name.split("/")[1] : (parsed.name ?? name);
        const pkgResources = parseDataPackageResources(parsed.resources ?? parsed.modelscript?.resources);
        const mergedRes = mergeResources(pkgResources);
        return {
          manifest: {
            globalAssetId: parsed.modelscript?.globalAssetId ?? `urn:modelscript:${parsed.name ?? name}`,
            idShort,
            title: parsed.title ?? parsed.description ?? idShort,
            version: parsed.version ?? version,
            scope,
            profile:
              parsed.profile ??
              parsed.modelscript?.profile ??
              storedProfile ??
              (mergedRes && mergedRes.length > 0 ? "engineering-data-package" : undefined),
            description: parsed.description,
            license: parsed.license,
            homepage: parsed.homepage,
            repository: parsed.repository,
            scripts: parsed.scripts,
            resources: mergedRes,
            dependencies: parsed.dependencies ?? storedDeps,
          },
          extractedDir,
        };
      } catch {
        // Fall through
      }
    }
  }

  // Fallback: Synthesize from package record
  const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
  const idShort = (name.startsWith("@") ? name.split("/")[1] : name) || name;
  const mergedRes = mergeResources();

  return {
    manifest: {
      globalAssetId: `urn:modelscript:${name}`,
      idShort,
      title: pkgRecord?.description ?? idShort,
      version,
      scope,
      profile: storedProfile ?? (mergedRes && mergedRes.length > 0 ? "engineering-data-package" : undefined),
      description: pkgRecord?.description ?? undefined,
      license: pkgRecord?.license ?? "UNLICENSED",
      homepage: pkgRecord?.homepage ?? undefined,
      repository: pkgRecord?.repository_url
        ? { type: pkgRecord.repository_type ?? "git", url: pkgRecord.repository_url }
        : undefined,
      resources: mergedRes,
      dependencies: storedDeps,
    },
    extractedDir,
  };
}

/**
 * Compliance, supply-chain, SBOM, SLSA provenance, OSV vulnerability audit,
 * and deterministic lockfile sub-router mounted inside `packagesRouter`.
 */
export function packagesComplianceRouter(storage: LibraryStorage, database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/libraries/:name/:version/lockfile
   * GET /api/v1/libraries/:scope/:name/:version/lockfile
   * GET /api/v1/libraries/:name/:version/export/lockfile
   * GET /api/v1/libraries/:scope/:name/:version/export/lockfile
   * Generate and export a deterministic, content-addressed datapackage.lock.json
   * capturing all transitive package dependencies and dataset resource hashes.
   */
  router.get(
    [
      "/:name/:version/lockfile",
      "/:scope/:name/:version/lockfile",
      "/:name/:version/export/lockfile",
      "/:scope/:name/:version/export/lockfile",
    ],
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      try {
        const lockfile = resolveDataPackageLockfile(storage, database, name, version);
        if (req.path.endsWith("/export/lockfile")) {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${name.replace(/\//g, "-")}-${version}.datapackage.lock.json"`,
          );
        }
        res.json(lockfile);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/sbom.json
   * GET /api/v1/libraries/:scope/:name/:version/sbom.json
   * Export an automated Software Bill of Materials (SBOM) in CycloneDX 1.6 or SPDX 2.3/3.0 format.
   * Query params: `format` ("cyclonedx" | "spdx", default: "cyclonedx"), `export` (boolean).
   */
  router.get(
    ["/:name/:version/sbom.json", "/:scope/:name/:version/sbom.json"],
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);
      const format = (req.query["format"] as string | undefined)?.toLowerCase() === "spdx" ? "spdx" : "cyclonedx";
      const isExport = req.query["export"] === "true" || req.query["export"] === "1";

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      try {
        const { manifest } = await resolveCanonicalManifest(storage, database, name, version);
        const lockfile = resolveDataPackageLockfile(storage, database, name, version);
        const release = database.getLibraryRelease(name, version);
        const contentHash = release?.content_hash || storage.getContentHash(name, version);
        const pkgRecord = database.getPackage(name);

        const rootOsvScan = await scanPackageVulnerabilities(name, version);
        const depOsvMap = await scanDependenciesVulnerabilities(lockfile.packages);

        if (format === "spdx") {
          const sanitizeSpdx = (s: string) => s.replace(/[^a-zA-Z0-9.-]/g, "-");
          const encodePkgPath = (p: string) =>
            p.startsWith("@") ? p.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(p);
          const rootSpdxId = `SPDXRef-Package-${sanitizeSpdx(name)}`;
          const rootSecRefs = formatSpdxSecurityRefs(rootOsvScan.vulnerabilities);
          const packages: Record<string, unknown>[] = [
            {
              name,
              SPDXID: rootSpdxId,
              versionInfo: version,
              downloadLocation: `https://ansatz.social/api/v1/libraries/${encodePkgPath(name)}/${encodeURIComponent(version)}/download`,
              filesAnalyzed: false,
              checksums: contentHash
                ? [
                    {
                      algorithm: "SHA256",
                      checksumValue: contentHash.replace(/^sha256:/i, ""),
                    },
                  ]
                : [],
              licenseConcluded: manifest.license || "NOASSERTION",
              licenseDeclared: manifest.license || "NOASSERTION",
              copyrightText: "NOASSERTION",
              externalRefs: [
                {
                  referenceCategory: "PACKAGE-MANAGER",
                  referenceType: "purl",
                  referenceLocator: `pkg:modelscript/${name}@${version}`,
                },
                ...rootSecRefs,
              ],
            },
          ];

          const relationships: Record<string, string>[] = [
            {
              spdxElementId: "SPDXRef-DOCUMENT",
              relationshipType: "DESCRIBES",
              relatedSpdxElement: rootSpdxId,
            },
          ];

          for (const [depKey, dep] of Object.entries(lockfile.packages)) {
            const lastAt = depKey.lastIndexOf("@");
            const depName = lastAt > 0 ? depKey.slice(0, lastAt) : depKey;
            const depVer = dep.version || (lastAt > 0 ? depKey.slice(lastAt + 1) : "1.0.0");
            if (depName === name && depVer === version) continue;
            const depSpdxId = `SPDXRef-Package-${sanitizeSpdx(depName)}`;
            const depAdvs = depOsvMap.get(`${depName}@${depVer}`) || [];
            packages.push({
              name: depName,
              SPDXID: depSpdxId,
              versionInfo: depVer,
              downloadLocation: `https://ansatz.social/api/v1/libraries/${encodePkgPath(depName)}/${encodeURIComponent(depVer)}/download`,
              filesAnalyzed: false,
              checksums: dep.integrity
                ? [
                    {
                      algorithm: "SHA256",
                      checksumValue: dep.integrity.replace(/^sha256:/i, ""),
                    },
                  ]
                : [],
              licenseConcluded: "NOASSERTION",
              licenseDeclared: "NOASSERTION",
              copyrightText: "NOASSERTION",
              externalRefs: [
                {
                  referenceCategory: "PACKAGE-MANAGER",
                  referenceType: "purl",
                  referenceLocator: `pkg:modelscript/${depName}@${depVer}`,
                },
                ...formatSpdxSecurityRefs(depAdvs),
              ],
            });

            relationships.push({
              spdxElementId: rootSpdxId,
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: depSpdxId,
            });
          }

          const spdxDoc: Record<string, unknown> = {
            spdxVersion: "SPDX-2.3",
            dataLicense: "CC0-1.0",
            SPDXID: "SPDXRef-DOCUMENT",
            name: `${name}@${version}`,
            documentNamespace: `https://ansatz.social/spdx/${name.replace(/\//g, "-")}-${version}-${crypto.randomUUID()}`,
            creationInfo: {
              created: new Date().toISOString(),
              creators: ["Tool: ModelScript Package Security Engine 1.0.0"],
            },
            documentDescribes: [rootSpdxId],
            packages,
            relationships,
          };

          if (release?.oidc_repository) {
            spdxDoc["annotations"] = [
              {
                annotator: `Tool: Keyless OIDC Attestation (${release.oidc_issuer || "CI/CD"})`,
                annotationDate: release.published_at || new Date().toISOString(),
                annotationType: "REVIEW",
                comment: `Verified Keyless CI build from repository ${release.oidc_repository} (workflow: ${release.oidc_workflow_ref || "CI"}, run: ${release.oidc_run_id || "ambient"})`,
              },
            ];
          }

          if (isExport) {
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${name.replace(/\//g, "-")}-${version}.spdx.json"`,
            );
          }
          res.json(spdxDoc);
          return;
        }

        // Default: CycloneDX 1.6 JSON
        const components: Record<string, unknown>[] = [];
        const dependencies: Record<string, unknown>[] = [];
        const rootDependsOn: string[] = [];

        for (const [depKey, dep] of Object.entries(lockfile.packages)) {
          const lastAt = depKey.lastIndexOf("@");
          const depName = lastAt > 0 ? depKey.slice(0, lastAt) : depKey;
          const depVer = dep.version || (lastAt > 0 ? depKey.slice(lastAt + 1) : "1.0.0");
          if (depName === name && depVer === version) continue;
          const purl = `pkg:modelscript/${depName}@${depVer}`;
          rootDependsOn.push(purl);

          components.push({
            type: "library",
            "bom-ref": purl,
            name: depName,
            version: depVer,
            purl,
            hashes: dep.integrity
              ? [
                  {
                    alg: "SHA-256",
                    content: dep.integrity.replace(/^sha256:/i, ""),
                  },
                ]
              : undefined,
          });

          if (dep.dependencies && Object.keys(dep.dependencies).length > 0) {
            dependencies.push({
              ref: purl,
              dependsOn: Object.keys(dep.dependencies).map((child) => {
                const childEntry =
                  lockfile.packages[child] ??
                  Object.entries(lockfile.packages).find(([k]) => k.startsWith(`${child}@`))?.[1];
                const childVer = childEntry?.version || "*";
                return `pkg:modelscript/${child}@${childVer}`;
              }),
            });
          }
        }

        const rootPurl = `pkg:modelscript/${name}@${version}`;
        dependencies.unshift({
          ref: rootPurl,
          dependsOn: rootDependsOn,
        });

        const allAdvisories: Array<{ advisory: (typeof rootOsvScan.vulnerabilities)[number]; purl: string }> = [];
        for (const adv of rootOsvScan.vulnerabilities) {
          allAdvisories.push({ advisory: adv, purl: rootPurl });
        }
        for (const [depKey, advs] of depOsvMap.entries()) {
          const depPurl = `pkg:modelscript/${depKey}`;
          for (const adv of advs) {
            allAdvisories.push({ advisory: adv, purl: depPurl });
          }
        }
        const cyclonedxVulns: Record<string, unknown>[] = [];
        for (const item of allAdvisories) {
          cyclonedxVulns.push(...formatCycloneDxVulnerabilities([item.advisory], item.purl));
        }

        const cycloneDxDoc = {
          $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          serialNumber: `urn:uuid:${crypto.randomUUID()}`,
          version: 1,
          metadata: {
            timestamp: new Date().toISOString(),
            tools: {
              components: [
                {
                  type: "application",
                  name: "ModelScript Hardened Package Engine",
                  version: "1.0.0",
                },
              ],
            },
            component: {
              type: "library",
              "bom-ref": rootPurl,
              name,
              version,
              description: manifest.description || pkgRecord?.description,
              licenses: manifest.license ? [{ license: { id: manifest.license } }] : undefined,
              purl: rootPurl,
              hashes: contentHash
                ? [
                    {
                      alg: "SHA-256",
                      content: contentHash.replace(/^sha256:/i, ""),
                    },
                  ]
                : undefined,
              evidence: release?.oidc_repository
                ? {
                    identity: {
                      field: "purl",
                      confidence: 1.0,
                      methods: [{ technique: "oidc-keyless-ci", value: release.oidc_repository }],
                    },
                  }
                : undefined,
            },
          },
          components,
          dependencies,
          vulnerabilities: cyclonedxVulns.length > 0 ? cyclonedxVulns : undefined,
        };

        if (isExport) {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${name.replace(/\//g, "-")}-${version}.cyclonedx.json"`,
          );
        }
        res.json(cycloneDxDoc);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/provenance.json
   * GET /api/v1/libraries/:scope/:name/:version/provenance.json
   * GET /api/v1/libraries/:name/:version/provenance.intoto.jsonl
   * GET /api/v1/libraries/:scope/:name/:version/provenance.intoto.jsonl
   *
   * Generate an in-toto v1 Statement with SLSA v1.0 Provenance predicate (SLSA Build Level 3).
   * Query params: `format` ("statement" | "dsse" | "full", default: "statement"), `export` (boolean).
   */
  router.get(
    [
      "/:name/:version/provenance.json",
      "/:scope/:name/:version/provenance.json",
      "/:name/:version/provenance.intoto.jsonl",
      "/:scope/:name/:version/provenance.intoto.jsonl",
    ],
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);
      const isJsonl = req.path.endsWith(".jsonl") || req.query["format"] === "jsonl";
      const format = (req.query["format"] as string | undefined)?.toLowerCase() || (isJsonl ? "jsonl" : "statement");
      const isExport = req.query["export"] === "true" || req.query["export"] === "1";

      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      try {
        const { manifest } = await resolveCanonicalManifest(storage, database, name, version);
        const lockfile = resolveDataPackageLockfile(storage, database, name, version);
        const release = database.getLibraryRelease(name, version);
        const contentHash = release?.content_hash || storage.getContentHash(name, version);
        const pkgRecord = database.getPackage(name);

        const provenance = generateSlsaProvenance({
          packageName: name,
          version,
          contentHash: contentHash || undefined,
          manifest: manifest as unknown as Record<string, unknown>,
          release: release || undefined,
          packageRecord: pkgRecord || undefined,
          dependencies: lockfile.packages,
        });

        const cleanName = name.replace(/^@/, "").replace(/\//g, "-");

        if (isJsonl) {
          if (isExport) {
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${cleanName}-${version}.provenance.intoto.jsonl"`,
            );
          }
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.send(JSON.stringify(provenance.statement) + "\n");
          return;
        }

        if (isExport) {
          res.setHeader("Content-Disposition", `attachment; filename="${cleanName}-${version}.provenance.json"`);
        }

        if (format === "dsse") {
          if (!provenance.dsseEnvelope) {
            res.status(404).json({ error: `No cryptographic signature envelope available for ${name}@${version}` });
            return;
          }
          res.json(provenance.dsseEnvelope);
          return;
        }

        if (format === "full") {
          res.json(provenance);
          return;
        }

        res.json(provenance.statement);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * GET /api/v1/libraries/:name/:version/audit
   * GET /api/v1/libraries/:scope/:name/:version/audit
   *
   * Perform an OSV vulnerability audit for a library and its transitive dependencies.
   */
  router.get(
    ["/:name/:version/audit", "/:scope/:name/:version/audit"],
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);
      if (!name || !version) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }
      try {
        const lockfile = resolveDataPackageLockfile(storage, database, name, version);
        const rootScan = await scanPackageVulnerabilities(name, version, { allowRemote: true });
        const depMap = await scanDependenciesVulnerabilities(lockfile.packages);
        const depVulns = Object.fromEntries(depMap);

        const totalVulns =
          rootScan.vulnerabilities.length + Array.from(depMap.values()).reduce((a, b) => a + b.length, 0);

        res.json({
          package: name,
          version,
          rootVulnerabilities: rootScan.vulnerabilities,
          dependencyVulnerabilities: depVulns,
          summary: {
            ...rootScan.summary,
            total: totalVulns,
          },
          clean: totalVulns === 0,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /**
   * POST /api/v1/libraries/resolve-lockfile
   * Resolve a deterministic datapackage.lock.json from an ad-hoc workspace manifest or cloud simulation job spec.
   */
  router.post("/resolve-lockfile", (req: Request, res: Response): void => {
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        version?: string;
        dependencies?: Record<string, string>;
        sourceContent?: string;
        engine?: string | { modelscript?: string; compilerTarget?: string; solver?: string };
        experiment?: {
          solver?: string;
          startTime?: number;
          stopTime?: number;
          interval?: number;
          numberOfIntervals?: number;
          tolerance?: number;
        };
      };
      const rootName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "workspace";
      const rootVersion = typeof body.version === "string" && body.version.trim() ? body.version.trim() : "0.0.0";
      const engineName =
        typeof body.engine === "string"
          ? body.engine
          : body.engine?.compilerTarget || body.engine?.modelscript || undefined;
      const lockfile = resolveDataPackageLockfile(storage, database, rootName, rootVersion, {
        extraDependencies: body.dependencies,
        sourceContent: body.sourceContent,
        engine: engineName,
        experiment: body.experiment,
      });
      res.json({ lockfile });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
