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
import { convertStepBufferToJson } from "./util/cad-converter.js";
import { extractModelicaComponentsFromSource } from "./util/class-source-inspector.js";
import { indexDataPackageResources } from "./util/datapackage-indexer.js";
import { exportLspBundle } from "./util/lsp-bundle-exporter.js";
import {
  indexRemainingPolyglotFiles,
  indexSysmlFiles,
  renderPolyglotClassDiagramSvg,
} from "./util/polyglot-doc-indexer.js";
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
  async (data: {
    name: string;
    version: string;
    libraryPath: string;
    storageDir?: string | undefined;
    dbDir?: string | undefined;
  }) => {
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

      let rootMetadata: { description: string | null; documentation: string | null } | null = null;
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

      let queryEngineRef: QueryEngine | null = null;

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

        type SymbolIndexType = ConstructorParameters<typeof QueryEngine>[0];
        type SymbolEntryType = SymbolIndexType["symbols"] extends Map<number, infer E> ? E : never;

        if (queryEngineRef) {
          const qeWithIndex = queryEngineRef as unknown as { index: SymbolIndexType };
          unifiedWs.registerWorkspace("modelica", {
            toSymbolIndex: () => qeWithIndex.index,

            toUnified: () => qeWithIndex.index,
          });
        } else {
          // Fallback for polyglot packages with loose .mo files without a root package.mo
          const symbols = new Map<number, SymbolEntryType>();
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
                const extractedComps = extractModelicaComponentsFromSource(content).map((c) => ({
                  name: c.component_name,
                  typeName: c.type_name,
                  description: c.description,
                  causality: c.causality,
                  variability: c.variability,
                  modifiers: c.modifiers.map((m) => ({ name: m.modifier_name, value: m.modifier_value })),
                }));
                metadataBatch.push({
                  className,
                  classKind: "model",
                  description: `Modelica model: ${className}`,
                  documentation: null,
                  baseClasses,
                  components: extractedComps,
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
                startOffset: classMatch?.index ?? 0,
                endOffset: content.length,
                parentId: null,
                exports: [],
                inherits: baseClasses,
                resourceId: fileUri,
                metadata: {
                  qualifiedName: className,
                },
              } as unknown as SymbolEntryType;
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
          const modelicaIndex = { symbols, byName, childrenOf } as unknown as SymbolIndexType;
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

        let sysmlParser: Awaited<ReturnType<typeof createWasmParser>>["parser"] | null = null;
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

        const sysmlTextByUri = new Map<string, string>();
        type RegisterTreeReturn = ReturnType<NonNullable<Parameters<typeof sysmlWs.register>[1]>>;
        for (const file of sysmlFiles) {
          try {
            const text = fs.readFileSync(file, "utf-8");
            const fileUri = "file://" + path.resolve(file);
            sysmlTextByUri.set(fileUri, text);
            if (sysmlParser) {
              const tree = sysmlParser.parse(text);

              sysmlWs.register(fileUri, () => (tree ? (tree.rootNode as unknown as RegisterTreeReturn) : null));
            } else {
              sysmlWs.register(fileUri);
            }
          } catch (err) {
            console.warn(`[publish] Failed to index SysML file ${file}:`, err);
          }
        }
        unifiedWs.registerWorkspace("sysml2", sysmlWs);

        const sysmlIndexed = await indexSysmlFiles({
          extractedDir: libraryPath,
          packageName: name,
          version,
        });
        for (const item of sysmlIndexed) {
          if (!processedClassNames.has(item.metadata.className)) {
            if (item.metadata.className === name) {
              rootMetadata = item.metadata;
            }
            storage.storeSvg(name, version, item.metadata.className, item.iconSvg, item.diagramSvg);
            if (item.iconSvg) {
              iconSvgs[item.metadata.className] = item.iconSvg;
            }
            metadataBatch.push(item.metadata);
            processedClassNames.add(item.metadata.className);
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

            // Pre-tessellate CAD WebGL mesh and store in cache
            const relPath = path.relative(libraryPath, file);
            try {
              const text = fileBuf.toString("utf-8");
              const meshData = await convertStepBufferToJson(new Uint8Array(fileBuf), text);
              storage.storeCadMesh(name, version, relPath, JSON.stringify(meshData));
              console.log(`[publish] ${name}@${version}: cached pre-tessellated CAD mesh for ${relPath}`);
            } catch (meshErr) {
              console.warn(`[publish] Failed to pre-tessellate CAD mesh for ${relPath}:`, meshErr);
            }
          } catch (err) {
            console.warn(`[publish] Failed to index STEP file ${file}:`, err);
          }
        }
        unifiedWs.registerWorkspace("step", stepWs);

        const stepIndex = stepWs.toSymbolIndex();
        for (const entry of stepIndex.symbols.values()) {
          if (entry.parentId === null || entry.parentId === 0) {
            if (!processedClassNames.has(entry.name)) {
              const childIds = stepIndex.childrenOf.get(entry.id) || [];
              const stepComps = childIds
                .map((cid) => stepIndex.symbols.get(cid))
                .filter((c): c is NonNullable<typeof c> => Boolean(c && c.name))
                .map((c) => ({
                  name: c.name,
                  typeName: c.kind || "STEPPart",
                  description: (c.metadata?.["description"] as string) || null,
                  causality: null,
                  variability: null,
                  modifiers: [],
                }));
              const stepMeta: ClassMetadata = {
                className: entry.name,
                classKind: "cad-assembly",
                description: `STEP CAD assembly: ${entry.name}`,
                documentation: `<p>ISO 10303 STEP CAD assembly <code>${entry.name}</code> with ${stepComps.length} structural B-Rep components.</p>`,
                baseClasses: [],
                components: stepComps,
              };
              const { iconSvg, diagramSvg } = renderPolyglotClassDiagramSvg(stepMeta, "STEP ISO 10303", "#0f766e");
              storage.storeSvg(name, version, stepMeta.className, iconSvg, diagramSvg);
              if (iconSvg) iconSvgs[stepMeta.className] = iconSvg;
              metadataBatch.push(stepMeta);
              processedClassNames.add(entry.name);
            }
          }
        }
      }

      // 3b. Process remaining 41 polyglot engineering languages (PSCAD, SSP, SPICE, OpenSCAD, URDF, SBML, ReqIF, AUTOSAR, PLCopen, Verilog-A, Simulink, C, Fortran, OWL2, CFD, FEA, PSS/E, OpenDSS, etc.)
      const polyglotItems = indexRemainingPolyglotFiles({
        extractedDir: libraryPath,
        packageName: name,
        version,
      });
      for (const item of polyglotItems) {
        if (!processedClassNames.has(item.metadata.className)) {
          storage.storeSvg(name, version, item.metadata.className, item.iconSvg, item.diagramSvg);
          if (item.iconSvg) iconSvgs[item.metadata.className] = item.iconSvg;
          metadataBatch.push(item.metadata);
          processedClassNames.add(item.metadata.className);
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

      type HooksMapType = NonNullable<ConstructorParameters<typeof QueryEngine>[1]>;
      type HookValueType = HooksMapType extends Map<string, infer V> ? V : never;
      const polyglotHooks: HooksMapType = new Map<string, HookValueType>();
      if (queryEngineRef) {
        const qeWithHooks = queryEngineRef as unknown as { hooksByRule?: HooksMapType | undefined };
        for (const [k, v] of qeWithHooks.hooksByRule?.entries?.() ?? []) {
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
        const pkgJsonPath = path.join(libraryPath, "package.json");
        const msJsonPath = path.join(libraryPath, "modelscript.json");
        const manifestPath = fs.existsSync(pkgJsonPath) ? pkgJsonPath : fs.existsSync(msJsonPath) ? msJsonPath : null;
        manifestStr = manifestPath ? fs.readFileSync(manifestPath, "utf-8") : "{}";
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

      if (!rootMetadata?.documentation) {
        const indexedClasses = database.getClasses(name, version);
        if (indexedClasses.length > 0) {
          const topClasses = indexedClasses.filter((c) => !c.class_name.includes(".")).slice(0, 40);
          const summaryLines = [
            `# ${name} (\`v${version}\`)`,
            "",
            rootMetadata?.description ||
              `Engineering artifact package containing ${indexedClasses.length} indexed symbols.`,
            "",
            "## Indexed Modules & Definitions",
            "",
            ...(topClasses.length > 0 ? topClasses : indexedClasses.slice(0, 40)).map(
              (c) => `- **\`${c.class_name}\`** (_${c.class_kind}_)${c.description ? ` — ${c.description}` : ""}`,
            ),
          ];
          rootMetadata = {
            description: rootMetadata?.description || `Engineering artifact package (${indexedClasses.length} symbols)`,
            documentation: summaryLines.join("\n"),
          };
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

      // Merge any declared Data Package resources (datapackage.json / CAS / S3 / explicit Table Schemas)
      try {
        await indexDataPackageResources(database, versionId, libraryPath, manifestStr);
      } catch (dpErr) {
        console.warn(`[publish] Failed to index Data Package resources for ${name}@${version}:`, dpErr);
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
