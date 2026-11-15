// SPDX-License-Identifier: AGPL-3.0-or-later

import type { XmlElement } from "@modelscript/dsl/xml";
import { createZip, generateFmiLsEmtAnnotationXml } from "@modelscript/exchange";
import type { DiagramComponentSpec, LibrarySymbolStub, ModelscriptLibraryManifest } from "@modelscript/runtime";
import * as fs from "node:fs";
import * as path from "node:path";
import { readDefinitionForm } from "../model/definition-form.js";
import { buildProjectModel, type ModelDefinition } from "../model/pscad-model.js";

export interface PscadExtractOptions {
  /** Package name for `package.json` (defaults to project name). */
  packageName?: string | undefined;
  /** Package version (default `"0.1.0"`). */
  version?: string | undefined;
  /** Implementation stub language for component physics (default `"assemblyscript"`). */
  implLang?: "assemblyscript" | "c" | "fortran" | undefined;
  /** Include FlyBy/help comments & parameter descriptions (default `false` — stripped for clean-room IP safety). */
  includeComments?: boolean | undefined;
  /** Include raw `<graphic>` SVG/vector snippets if present (default `false`). */
  includeGraphics?: boolean | undefined;
  /** Include raw Fortran/Computations/Dsdyn/Dsout script segments (default `false`). */
  includeScripts?: boolean | undefined;
}

export interface ExtractedPscadPackage {
  packageJson: Record<string, unknown>;
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
  files: Map<string, string>;
}

function sanitizeIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function generateAssemblyScriptStub(def: ModelDefinition, paramKeys: string[]): string {
  const safe = sanitizeIdent(def.name);
  const paramComments = paramKeys.map((k) => `//   param: ${k}`).join("\n");
  return [
    `// Clean-room AssemblyScript/WASM stub for PSCAD component '${def.name}'`,
    `// Implements the FMI 3.0 Layered Standard for EMT (fmi-ls-emt) Norton-companion ABI.`,
    paramComments || "//   (no parameters)",
    ``,
    `export function ${safe}_stampCompanion(tSec: f64, dtSec: f64, gEqPtr: usize, iHistPtr: usize): void {`,
    `  // TODO: Compute 3x3 companion conductance matrix (S) into gEqPtr and 3-phase history current (A) into iHistPtr`,
    `  // store<f64>(gEqPtr, 0.0);`,
    `  // store<f64>(iHistPtr, 0.0);`,
    `}`,
    ``,
    `export function ${safe}_doStep(tSec: f64, dtSec: f64, vNodePtr: usize): void {`,
    `  // TODO: Advance internal companion states given solved terminal voltages [va, vb, vc] at vNodePtr`,
    `}`,
    ``,
  ].join("\n");
}

function generateCStub(def: ModelDefinition, paramKeys: string[]): string {
  const safe = sanitizeIdent(def.name);
  const paramComments = paramKeys.map((k) => ` *   param: ${k}`).join("\n");
  return [
    `/* Clean-room C/WASM stub for PSCAD component '${def.name}' (fmi-ls-emt ABI) */`,
    `/*`,
    paramComments || " *   (no parameters)",
    ` */`,
    `#include <stdint.h>`,
    ``,
    `void ${safe}_stampCompanion(double tSec, double dtSec, double* gEq, double* iHist) {`,
    `  /* TODO: Populate gEq[0..8] (S) and iHist[0..2] (A) */`,
    `}`,
    ``,
    `void ${safe}_doStep(double tSec, double dtSec, const double* vNode) {`,
    `  /* TODO: Advance internal companion states using vNode[0..2] (V) */`,
    `}`,
    ``,
  ].join("\n");
}

function generateFortranStub(def: ModelDefinition, paramKeys: string[]): string {
  const safe = sanitizeIdent(def.name);
  const paramComments = paramKeys.map((k) => `!   param: ${k}`).join("\n");
  return [
    `! Clean-room Fortran stub for PSCAD component '${def.name}' (fmi-ls-emt ABI)`,
    paramComments || "!   (no parameters)",
    `subroutine ${safe}_stamp_companion(t_sec, dt_sec, g_eq, i_hist) bind(C)`,
    `  use iso_c_binding`,
    `  real(c_double), value :: t_sec, dt_sec`,
    `  real(c_double), intent(out) :: g_eq(9), i_hist(3)`,
    `  g_eq = 0.0d0`,
    `  i_hist = 0.0d0`,
    `end subroutine ${safe}_stamp_companion`,
    ``,
    `subroutine ${safe}_do_step(t_sec, dt_sec, v_node) bind(C)`,
    `  use iso_c_binding`,
    `  real(c_double), value :: t_sec, dt_sec`,
    `  real(c_double), intent(in) :: v_node(3)`,
    `end subroutine ${safe}_do_step`,
    ``,
  ].join("\n");
}

function buildFmuXmls(
  def: ModelDefinition,
  paramKeys: string[],
  description?: string,
): {
  modelDescriptionXml: string;
  terminalsAndIconsXml: string;
} {
  const safe = sanitizeIdent(def.name);
  const elecPorts = def.ports.filter((p) => p.electype > 0 || p.dim > 1);
  const terminalBindings = (elecPorts.length > 0 ? elecPorts : [{ name: "Term", dim: 3 }]).map((p) => ({
    terminalName: p.name,
    phases: p.dim > 1 ? 3 : 1,
    vNodeVar: `${p.name}_v`,
    gEqVar: `${p.name}_G_eq`,
    iHistVar: `${p.name}_I_hist`,
  }));

  const fmiLsEmtAnn = generateFmiLsEmtAnnotationXml({
    version: "1.0",
    supportsHalfStepCda: true,
    supportsNewtonIteration: false,
    terminals: terminalBindings,
  });

  const paramVars = paramKeys
    .map(
      (k, idx) =>
        `    <Float64 name="${k}" valueReference="${idx + 1}" causality="parameter" variability="fixed" start="0.0"/>`,
    )
    .join("\n");

  const modelDescriptionXml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<fmiModelDescription fmiVersion="3.0" modelName="${safe}" instantiationToken="{${safe}-emt}">`,
    ...(description ? [`  <!-- ${description.replace(/--/g, "-")} -->`] : []),
    `  <CoSimulation modelIdentifier="${safe}"/>`,
    `  <ModelVariables>`,
    paramVars,
    `  </ModelVariables>`,
    `  <Annotations>`,
    fmiLsEmtAnn
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
    `  </Annotations>`,
    `</fmiModelDescription>`,
    ``,
  ].join("\n");

  const termEls = def.ports
    .map((p) => {
      const kind = p.electype > 0 || p.dim > 1 ? "electrical" : "signal";
      return [
        `    <Terminal name="${p.name}" terminalKind="${kind}">`,
        `      <Position x="${p.x}" y="${p.y}"/>`,
        `    </Terminal>`,
      ].join("\n");
    })
    .join("\n");

  const terminalsAndIconsXml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<fmiTerminalsAndIcons fmiVersion="3.0">`,
    `  <Terminals>`,
    termEls,
    `  </Terminals>`,
    `</fmiTerminalsAndIcons>`,
    ``,
  ].join("\n");

  return { modelDescriptionXml, terminalsAndIconsXml };
}

/**
 * Extracts a `.pscx` or `.pslx` file into a `package.json#modelscript` library package
 * with IP stripping enabled by default and AssemblyScript/C/Fortran + FMI 3.0 (`fmi-ls-emt`) stubs.
 */
export function extractPscadLibraryPackage(
  pscxOrPslxText: string,
  options: PscadExtractOptions = {},
): ExtractedPscadPackage {
  const model = buildProjectModel(pscxOrPslxText);
  const pkgName = options.packageName ?? `@modelscript/pscad-${sanitizeIdent(model.name || "library").toLowerCase()}`;
  const version = options.version ?? "0.1.0";
  const implLang = options.implLang ?? "assemblyscript";
  const includeComments = options.includeComments ?? false;
  const includeGraphics = options.includeGraphics ?? false;
  const includeScripts = options.includeScripts ?? false;

  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];
  const files = new Map<string, string>();

  for (const def of model.definitions.values()) {
    const form = readDefinitionForm(def);
    const paramList: Array<{ key: string; label: string; kind: string; defaultValue: string; description?: string }> =
      [];
    const seenKeys = new Set<string>();

    if (form) {
      for (const cat of form.categories) {
        for (const p of cat.parameters) {
          if (seenKeys.has(p.name)) continue;
          seenKeys.add(p.name);
          paramList.push({
            key: p.name,
            label: includeComments ? p.label : p.name,
            kind: p.type === "Choice" || p.type === "Text" ? "string" : "number",
            defaultValue: p.defaultValue || def.params.get(p.name) || "",
            ...(includeComments && p.unit ? { description: `Unit: ${p.unit}` } : {}),
          });
        }
      }
    }
    for (const [k, v] of def.params.entries()) {
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      paramList.push({ key: k, label: k, kind: "number", defaultValue: v });
    }

    const namePath = `${model.name}:${def.name}`;
    const paramKeys = paramList.map((p) => p.key);
    const flyByDesc = includeComments && def.flyBy ? def.flyBy.summary : undefined;

    symbols.push({
      name: def.name,
      kind: "pscad_component",
      ruleName: "UserCmpDefn",
      namePath,
      exports: paramKeys,
      inherits: [],
      metadata: {
        label: def.name,
        domain: def.ports.some((p) => p.electype > 0 || p.dim > 1) ? "electrical" : "control",
        parameters: paramList,
        ...(flyByDesc ? { description: flyByDesc } : {}),
      },
    });

    let svgSnippet: string | undefined;
    if (includeGraphics) {
      const findGraphic = (el: XmlElement): XmlElement | undefined => {
        for (const ch of el.children) {
          if (ch.name.toLowerCase() === "graphic") return ch;
          const nested = findGraphic(ch);
          if (nested) return nested;
        }
        return undefined;
      };
      const graphicEl = findGraphic(def.element);
      if (graphicEl) {
        svgSnippet = pscxOrPslxText.slice(graphicEl.start, graphicEl.end);
      }
    }

    diagrams.push({
      namePath,
      label: def.name,
      domain: def.ports.some((p) => p.electype > 0 || p.dim > 1) ? "electrical" : "control",
      width: 64,
      height: Math.max(48, def.ports.length * 20),
      ports: def.ports.map((p) => ({
        name: p.name,
        kind: p.electype > 0 || p.dim > 1 ? "electrical" : "signal",
        side: Math.abs(p.x) >= Math.abs(p.y) ? (p.x < 0 ? "left" : "right") : p.y < 0 ? "top" : "bottom",
        dx: p.x,
        dy: p.y,
      })),
      ...(svgSnippet ? { svg: svgSnippet } : {}),
    });

    const safe = sanitizeIdent(def.name);
    if (implLang === "c") {
      files.set(`src/${safe}.c`, generateCStub(def, paramKeys));
    } else if (implLang === "fortran") {
      files.set(`src/${safe}.f90`, generateFortranStub(def, paramKeys));
    } else {
      files.set(`src/${safe}.ts`, generateAssemblyScriptStub(def, paramKeys));
    }

    if (includeScripts && def.scripts) {
      for (const [segName, seg] of def.scripts.entries()) {
        files.set(`src/legacy/${safe}.${segName}.txt`, seg.content);
      }
    }

    const { modelDescriptionXml, terminalsAndIconsXml } = buildFmuXmls(def, paramKeys, flyByDesc);
    files.set(`fmus/${safe}/modelDescription.xml`, modelDescriptionXml);
    files.set(`fmus/${safe}/terminalsAndIcons.xml`, terminalsAndIconsXml);
  }

  const manifest: ModelscriptLibraryManifest = {
    category: "library",
    language: "pscad",
    symbols: "./dist/symbols.json",
    diagrams: "./dist/diagrams.json",
    runtime: {
      wasm: "./dist/runtime.wasm",
      fmus: "./fmus/",
    },
  };

  const packageJson: Record<string, unknown> = {
    name: pkgName,
    version,
    type: "module",
    scripts: implLang === "assemblyscript" ? { build: "asc src/index.ts --outFile dist/runtime.wasm --optimize" } : {},
    modelscript: manifest,
  };

  if (implLang === "assemblyscript") {
    const indexExports = Array.from(model.definitions.values())
      .map((d) => `export * from "./${sanitizeIdent(d.name)}.js";`)
      .join("\n");
    files.set("src/index.ts", indexExports + "\n");
  }

  files.set("package.json", JSON.stringify(packageJson, null, 2) + "\n");
  files.set("dist/symbols.json", JSON.stringify(symbols, null, 2) + "\n");
  files.set("dist/diagrams.json", JSON.stringify(diagrams, null, 2) + "\n");

  return { packageJson, symbols, diagrams, files };
}

/**
 * Writes an `ExtractedPscadPackage` to disk at `outDir`.
 */
export function writeExtractedPscadPackage(outDir: string, extracted: ExtractedPscadPackage): void {
  for (const [relPath, content] of extracted.files.entries()) {
    const full = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
}

/**
 * Builds an `.fmu` zip archive for a single component inside an extracted `package.json#modelscript`
 * library directory (including `modelDescription.xml`, `terminalsAndIcons.xml`, and optional `runtime.wasm`).
 */
export function buildFmuFromLibraryPackage(pkgDir: string, componentName: string, outFmuPath: string): Uint8Array {
  const safe = sanitizeIdent(componentName);
  const fmuDir = path.join(pkgDir, "fmus", safe);
  const mdPath = path.join(fmuDir, "modelDescription.xml");
  if (!fs.existsSync(mdPath)) {
    throw new Error(`Component FMU metadata not found at ${mdPath}`);
  }

  const zipFiles = new Map<string, Uint8Array>();
  zipFiles.set("modelDescription.xml", fs.readFileSync(mdPath));

  const tiPath = path.join(fmuDir, "terminalsAndIcons.xml");
  if (fs.existsSync(tiPath)) {
    zipFiles.set("terminalsAndIcons.xml", fs.readFileSync(tiPath));
  }

  const wasmPath = path.join(pkgDir, "dist", "runtime.wasm");
  if (fs.existsSync(wasmPath)) {
    zipFiles.set("binaries/wasm32/runtime.wasm", fs.readFileSync(wasmPath));
  }

  const bytes = createZip(zipFiles);
  fs.mkdirSync(path.dirname(outFmuPath), { recursive: true });
  fs.writeFileSync(outFmuPath, bytes);
  return bytes;
}
