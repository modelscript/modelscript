// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Child process script for processing a published library.
 *
 * Runs SVG rendering + metadata extraction in a separate process
 * so the main API event loop stays completely unblocked.
 *
 * Receives job data via IPC message: { name, version, libraryPath }
 * Sends IPC messages: { type: 'progress', classesProcessed } and { type: 'complete', classesProcessed }
 */

import { createWasmParser } from "@modelscript/dsl";
import { QueryEngine, UnifiedWorkspace } from "@modelscript/runtime";
import { StepWorkspaceIndex } from "@modelscript/step";
import {
  createSysML2WorkspaceIndex,
  loadEmbeddedKerMLStdlib,
  queryHooks as sysml2QueryHooks,
} from "@modelscript/sysml2/factory";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { initializeArtifactSystem } from "./artifacts/index.js";
import { getArtifactRegistry } from "./artifacts/registry.js";
import type { ClassMetadata } from "./database.js";
import { LibraryDatabase } from "./database.js";
import { LibraryStorage } from "./storage.js";
import { exportLspBundle } from "./util/lsp-bundle-exporter.js";
import { exportSalsaIndex } from "./util/salsa-index-exporter.js";
import { processLibrary } from "./util/svg-renderer.js";

initializeArtifactSystem();
const artifactRegistry = getArtifactRegistry();

function getArtifactType(filename: string): string | null {
  const detected = artifactRegistry.detectType(filename);
  if (detected) return detected;
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".step" || ext === ".stp") return "cad";
  if (ext === ".sysml") return "sysml";
  if (ext === ".fmu") return "fmu";
  if (ext === ".csv") return "dataset";
  if (ext === ".tei" || ext === ".xml") return "tei-document";
  return null;
}

process.on(
  "message",
  async (data: { name: string; version: string; libraryPath: string; storageDir?: string; dbDir?: string }) => {
    const { name, version, libraryPath, storageDir, dbDir } = data;

    const database = new LibraryDatabase(dbDir);
    const storage = new LibraryStorage(storageDir);

    try {
      console.log(`[publish] Processing ${name}@${version}...`);

      const existingClasses = database.getClasses(name, version);
      const processedClassNames = new Set(existingClasses.map((c) => c.class_name));

      console.log(`[publish] Checkpoint resume: ${processedClassNames.size} classes already processed.`);

      let metadataBatch: ClassMetadata[] = [];
      let classCount = processedClassNames.size;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rootMetadata: any = null;
      const iconSvgs: Record<string, string> = {};

      // Prepopulate iconSvgs from existing storage for the final lsp-bundle export
      const classesWithSvgs = storage.listClasses(name, version);
      for (const className of classesWithSvgs) {
        if (processedClassNames.has(className)) {
          const svg = storage.readSvg(name, version, className, "icon");
          if (svg) iconSvgs[className] = svg;
        }
      }

      const ignorePath = path.join(libraryPath, ".modelscriptignore");
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

      const findPackageFiles = (currentDir: string, relPrefix = ""): string[] => {
        const found: string[] = [];
        if (!fs.existsSync(currentDir)) return found;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          const shouldIgnore = ignorePatterns.some(
            (p) => relPath === p || relPath.startsWith(p + "/") || entry.name === p || entry.name.startsWith(p + "/"),
          );
          if (shouldIgnore) continue;

          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            found.push(...findPackageFiles(fullPath, relPath));
          } else if (entry.isFile()) {
            found.push(fullPath);
          }
        }
        return found;
      };

      const packageFiles = findPackageFiles(libraryPath);
      const modelicaFiles = packageFiles.filter((f) => f.endsWith(".mo"));
      const sysmlFiles = packageFiles.filter((f) => f.endsWith(".sysml") || f.endsWith(".kerml"));
      const stepFiles = packageFiles.filter((f) => f.endsWith(".step") || f.endsWith(".stp"));

      const hasModelica = modelicaFiles.length > 0;
      const hasSysML = sysmlFiles.length > 0;
      const hasStep = stepFiles.length > 0;

      console.log(
        `[publish] ${name}@${version}: discovered files — ${modelicaFiles.length} Modelica, ${sysmlFiles.length} SysML2, ${stepFiles.length} STEP CAD`,
      );

      const unifiedWs = new UnifiedWorkspace();
      unifiedWs.domainPartitioning = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let queryEngineRef: any = null;

      // 1. Process Modelica (if present)
      if (hasModelica) {
        console.log(`[publish] ${name}@${version}: processing Modelica library...`);
        await processLibrary(
          libraryPath,
          processedClassNames,
          async (_className, metadata, svgs) => {
            if (metadata.className === name) {
              rootMetadata = metadata;
            }
            storage.storeSvg(name, version, metadata.className, svgs.icon, svgs.diagram);
            if (svgs.icon) {
              iconSvgs[metadata.className] = svgs.icon;
            }

            metadataBatch.push(metadata);
            if (metadataBatch.length >= 50) {
              database.storeClassBatch(name, version, metadataBatch);
              classCount += metadataBatch.length;
              metadataBatch = [];

              process.send?.({ type: "progress", classesProcessed: classCount });

              if (classCount % 100 === 0) {
                console.log(`[publish] ${name}@${version}: processed ${classCount} classes...`);
              }
            }
          },
          async (readyContext) => {
            queryEngineRef = readyContext.queryEngine;
          },
        );

        if (queryEngineRef) {
          unifiedWs.registerWorkspace("modelica", {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            toSymbolIndex: () => (queryEngineRef as any).index,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            toUnified: () => (queryEngineRef as any).index,
          });
        } else {
          // Fallback for polyglot packages with loose .mo files without a root package.mo
          const symbols = new Map<number, any>();
          const byName = new Map<string, number[]>();
          const childrenOf = new Map<number | null, number[]>();
          let nextSeq = 1;

          for (const file of modelicaFiles) {
            try {
              const content = fs.readFileSync(file, "utf-8");
              const fileUri = "file://" + path.resolve(file);
              const classMatch = content.match(/\b(?:model|block|class|record|connector)\s+([A-Za-z_][A-Za-z0-9_]*)/);
              const className = classMatch ? (classMatch[1] ?? path.basename(file, ".mo")) : path.basename(file, ".mo");
              const baseClassMatch = content.match(/\bextends\s+([A-Za-z_][A-Za-z0-9_.:]*)/);
              const baseClasses = baseClassMatch ? [baseClassMatch[1]!] : [];

              if (!processedClassNames.has(className)) {
                metadataBatch.push({
                  className,
                  classKind: "model",
                  description: `Modelica model: ${className}`,
                  documentation: null,
                  baseClasses,
                  components: [],
                });
                processedClassNames.add(className);
              }

              const symId = nextSeq++;
              const entry = {
                id: symId,
                name: className,
                kind: "Class",
                ruleName: "class_definition",
                namePath: className,
                fieldName: null,
                startByte: classMatch?.index ?? 0,
                endByte: content.length,
                parentId: null,
                exports: [],
                inherits: baseClasses,
                resourceId: fileUri,
                metadata: {
                  qualifiedName: className,
                },
              };
              symbols.set(symId, entry);
              const existing = byName.get(className) || [];
              existing.push(symId);
              byName.set(className, existing);
              const roots = childrenOf.get(null) || [];
              roots.push(symId);
              childrenOf.set(null, roots);
            } catch (err) {
              console.warn(`[publish] Failed to index Modelica file ${file}:`, err);
            }
          }
          const modelicaIndex = { symbols, byName, childrenOf };
          unifiedWs.registerWorkspace("modelica", {
            toSymbolIndex: () => modelicaIndex,
            toUnified: () => modelicaIndex,
          });
        }
      }

      // 2. Process SysML v2 (if present)
      if (hasSysML) {
        console.log(`[publish] ${name}@${version}: indexing ${sysmlFiles.length} SysML v2 files...`);
        const sysmlWs = createSysML2WorkspaceIndex();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let sysmlParser: any = null;
        try {
          const require = createRequire(import.meta.url);
          const wasmPath = require.resolve("@modelscript/sysml2/dist/parser.wasm");
          const sysmlResult = await createWasmParser(wasmPath);
          sysmlParser = sysmlResult.parser;
        } catch (e) {
          console.warn(`[publish] Failed to initialize SysML2 parser wasm:`, e);
        }

        if (sysmlParser) {
          loadEmbeddedKerMLStdlib(sysmlWs, sysmlParser);
        }

        for (const file of sysmlFiles) {
          try {
            const text = fs.readFileSync(file, "utf-8");
            const fileUri = "file://" + path.resolve(file);
            if (sysmlParser) {
              const tree = sysmlParser.parse(text);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sysmlWs.register(fileUri, () => (tree ? (tree.rootNode as any) : null));
            } else {
              sysmlWs.register(fileUri);
            }
          } catch (err) {
            console.warn(`[publish] Failed to index SysML file ${file}:`, err);
          }
        }
        unifiedWs.registerWorkspace("sysml2", sysmlWs);

        const sysmlIndex = sysmlWs.toUnified();
        for (const entry of sysmlIndex.symbols.values()) {
          if (entry.resourceId && !entry.resourceId.startsWith("sysml2://stdlib/")) {
            if (entry.parentId === null || entry.parentId === 0) {
              if (!processedClassNames.has(entry.name)) {
                metadataBatch.push({
                  className: entry.name,
                  classKind: entry.kind.toLowerCase(),
                  description: (entry.metadata?.description as string) || null,
                  documentation: null,
                  baseClasses: entry.inherits || [],
                  components: [],
                });
                processedClassNames.add(entry.name);
              }
            }
          }
        }
      }

      // 3. Process STEP CAD (if present)
      if (hasStep) {
        console.log(`[publish] ${name}@${version}: indexing ${stepFiles.length} STEP CAD files...`);
        const stepWs = new StepWorkspaceIndex();
        for (const file of stepFiles) {
          try {
            const fileBuf = fs.readFileSync(file);
            const fileUri = "file://" + path.resolve(file);
            await stepWs.parseStepFile(fileUri, fileBuf);
          } catch (err) {
            console.warn(`[publish] Failed to index STEP file ${file}:`, err);
          }
        }
        unifiedWs.registerWorkspace("step", stepWs);

        const stepIndex = stepWs.toSymbolIndex();
        for (const entry of stepIndex.symbols.values()) {
          if (entry.parentId === null || entry.parentId === 0) {
            if (!processedClassNames.has(entry.name)) {
              metadataBatch.push({
                className: entry.name,
                classKind: "cad-assembly",
                description: `STEP CAD assembly: ${entry.name}`,
                documentation: null,
                baseClasses: [],
                components: [],
              });
              processedClassNames.add(entry.name);
            }
          }
        }
      }

      // Flush remaining metadata batch
      if (metadataBatch.length > 0) {
        database.storeClassBatch(name, version, metadataBatch);
        classCount += metadataBatch.length;
        metadataBatch = [];
      }

      // 4. Build and export unified polyglot Salsa index and LSP bundle
      const unifiedSymbolIndex = unifiedWs.toSymbolIndex();
      console.log(
        `[publish] ${name}@${version}: unified symbol index created with ${unifiedSymbolIndex.symbols.size} symbols.`,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const polyglotHooks = new Map<string, any>();
      if (queryEngineRef) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [k, v] of (queryEngineRef as any).hooksByRule?.entries?.() ?? []) {
          polyglotHooks.set(k, v);
        }
      }
      for (const [k, v] of sysml2QueryHooks.entries()) {
        polyglotHooks.set(k, v);
      }

      const polyglotEngine = new QueryEngine(unifiedSymbolIndex, polyglotHooks);
      const indexPath = storage.getIndexPath(name, version);

      console.log(`[publish] ${name}@${version}: exporting polyglot salsa-index.db...`);
      await exportSalsaIndex(polyglotEngine, indexPath);

      console.log(`[publish] ${name}@${version}: exporting polyglot lsp-bundle.zip...`);
      const bundlePath = path.join(path.dirname(indexPath), "lsp-bundle.zip");
      try {
        await exportLspBundle(polyglotEngine, libraryPath, bundlePath, iconSvgs);
      } catch (err) {
        console.warn(`[publish] ${name}@${version}: failed to export lsp-bundle:`, err);
      }

      // --- Automatic Artifact Scanning ---
      console.log(`[publish] ${name}@${version}: scanning artifacts...`);
      const { id: packageId } = database.getOrCreatePackage(name);
      const versionRow = database.getPackageVersion(packageId, version);
      let versionId: number;
      let manifestStr = "{}";
      if (versionRow) {
        versionId = versionRow.id;
        manifestStr = versionRow.manifest;
      } else {
        const manifestPath = path.join(libraryPath, "package.json");
        manifestStr = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf-8") : "{}";
        versionId = database.storePackageVersion(packageId, version, "", "", null, 0, manifestStr, null, null);
      }

      // --- Update package metadata and dependencies from annotations or manifest ---
      const rootDependencies: Record<string, string> = {};
      const packageMoPath = path.join(libraryPath, "package.mo");
      if (fs.existsSync(packageMoPath)) {
        const content = fs.readFileSync(packageMoPath, "utf-8");
        const depRegex = /([a-zA-Z0-9_]+)\s*\(\s*version\s*=\s*"([^"]+)"/g;
        let match;
        while ((match = depRegex.exec(content)) !== null) {
          if (match[1] && match[2] && match[1] !== "conversion" && match[1] !== "from") {
            rootDependencies[match[1]] = match[2];
          }
        }
      }

      if (!rootMetadata) {
        const rootClassRow = database.getClass(name, version, name);
        if (rootClassRow) {
          rootMetadata = {
            description: rootClassRow.description,
            documentation: rootClassRow.documentation,
          };
        }
      }

      if (!rootMetadata) {
        try {
          const manifestObj = JSON.parse(manifestStr);
          if (manifestObj.description) {
            rootMetadata = {
              description: manifestObj.description,
              documentation: null,
            };
          }
        } catch {}
      }

      const readmePath = path.join(libraryPath, "README.md");
      if (fs.existsSync(readmePath)) {
        const readmeText = fs.readFileSync(readmePath, "utf-8");
        if (!rootMetadata) {
          rootMetadata = { description: "", documentation: readmeText };
        } else if (!rootMetadata.documentation) {
          rootMetadata.documentation = readmeText;
        }
      }

      if (rootMetadata) {
        database.updatePackageMeta(packageId, {
          description: rootMetadata.description,
          readme: rootMetadata.documentation,
        });

        try {
          const manifestObj = JSON.parse(manifestStr);
          if (Object.keys(rootDependencies).length > 0) {
            manifestObj.dependencies = { ...manifestObj.dependencies, ...rootDependencies };
          }
          database.updatePackageVersionManifest(versionId, JSON.stringify(manifestObj));
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
          console.warn(`[publish] Failed to update manifest for ${name}@${version}`);
        }
      }

      // Scan individual artifact files into artifacts table
      for (const fullPath of packageFiles) {
        const relPath = path.relative(libraryPath, fullPath).replace(/\\/g, "/");
        const filename = path.basename(fullPath);
        const type = getArtifactType(filename);
        if (type) {
          let details: Record<string, unknown> = {};
          try {
            const fileBuf = fs.readFileSync(fullPath);
            const meta = await artifactRegistry.extractMetadata(type, fileBuf, relPath);
            if (meta?.details) {
              details = meta.details;
            }
          } catch (extractErr) {
            console.warn(`[publish] Failed to extract metadata for artifact ${relPath}:`, extractErr);
          }
          database.storeArtifact(versionId, type, relPath, JSON.stringify(details));
        }
      }
      // -----------------------------------
      // -----------------------------------

      console.log(`[publish] ${name}@${version}: completed — ${classCount} classes processed.`);
      process.send?.({ type: "complete", classesProcessed: classCount });
    } catch (err) {
      console.error(`[publish] Fatal error:`, err);
      process.exit(1);
    } finally {
      database.close();
      process.exit(0);
    }
  },
);
