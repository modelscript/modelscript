// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";
import { AEROSPACE_TEMPLATES } from "./domains/aerospace.js";
import {
  generateArtifactWorkspaceFiles,
  generatePackageWorkspaceFiles,
  getPackageDescriptor,
  joinPath,
  mountArtifactToMemFs,
  registerArtifactDescriptor,
  resolveStoredArtifactDescriptor,
} from "./domains/artifact-workspace.js";
import { AUTOMOTIVE_RAIL_TEMPLATES } from "./domains/automotive-rail.js";
import { CORE_SYSTEMS_TEMPLATES } from "./domains/core-systems.js";
import { ELECTRONICS_ROBOTICS_CIVIL_TEMPLATES } from "./domains/electronics-robotics-civil.js";
import { EMBEDDED_TELEMETRY_TEMPLATES } from "./domains/embedded-telemetry.js";
import { ENERGY_SUBSURFACE_MARINE_TEMPLATES } from "./domains/energy-subsurface-marine.js";
import { GEOMETRY_CAE_TEMPLATES } from "./domains/geometry-cae.js";
import { LANGUAGE_TILES } from "./domains/language-tiles.js";
import { LIFE_SCIENCES_MEDICAL_TEMPLATES } from "./domains/life-sciences-medical.js";
import { PROCESS_MANUFACTURING_TEMPLATES } from "./domains/process-manufacturing.js";
import {
  LANGUAGE_GROUPS,
  STANDARD_CAPABILITIES,
  type ArtifactWorkspaceDescriptor,
  type ExampleWorkspaceDescriptor,
  type IMemoryFileSystemProvider,
} from "./domains/types.js";
import { GENERATED_IDE_TEMPLATES } from "./generated/example-templates.generated.js";

export type {
  ArtifactWorkspaceDescriptor,
  CatalogTone,
  ExampleWorkspaceDescriptor,
  GeneratedWorkspace,
  IMemoryFileSystemProvider,
  LanguageGroupDescriptor,
  LanguageMaturityTier,
  LanguageTileDescriptor,
  RemoteFileEntry,
} from "./domains/types.js";

export { LANGUAGE_GROUPS, LANGUAGE_TILES };

export {
  clearArtifactRegistry,
  generateArtifactWorkspaceFiles,
  generatePackageWorkspaceFiles,
  getArtifactDescriptor,
  getPackageDescriptor,
  inferExtensionForArtifact,
  injectArtifactDependencies,
  mountArtifactToMemFs,
  POLYGLOT_VIEW_TYPE_EXTENSIONS,
  registerArtifactDescriptor,
  registerPackageDescriptor,
  sanitizeModelicaIdentifier,
} from "./domains/artifact-workspace.js";

// ── Level 2: Verified Example Workspaces Across All Languages ──────────────

export const EXAMPLE_TEMPLATES: ExampleWorkspaceDescriptor[] = [
  ...CORE_SYSTEMS_TEMPLATES,
  ...GEOMETRY_CAE_TEMPLATES,
  ...EMBEDDED_TELEMETRY_TEMPLATES,
  ...AEROSPACE_TEMPLATES,
  ...AUTOMOTIVE_RAIL_TEMPLATES,
  ...ENERGY_SUBSURFACE_MARINE_TEMPLATES,
  ...ELECTRONICS_ROBOTICS_CIVIL_TEMPLATES,
  ...PROCESS_MANUFACTURING_TEMPLATES,
  ...LIFE_SCIENCES_MEDICAL_TEMPLATES,
];

// ── Lookup Maps & Empty Workspace Definition ───────────────────────────────

export const EMPTY_WORKSPACE_FILES: Record<string, string> = {};

export const EXAMPLE_BY_ID = new Map<string, ExampleWorkspaceDescriptor>(EXAMPLE_TEMPLATES.map((ex) => [ex.id, ex]));

export const EXAMPLES_BY_LANGUAGE = new Map<string, ExampleWorkspaceDescriptor[]>();
for (const tile of LANGUAGE_TILES) {
  EXAMPLES_BY_LANGUAGE.set(tile.id, []);
}
for (const ex of EXAMPLE_TEMPLATES) {
  const list = EXAMPLES_BY_LANGUAGE.get(ex.languageId) ?? [];
  list.push(ex);
  EXAMPLES_BY_LANGUAGE.set(ex.languageId, list);
}
for (const gen of GENERATED_IDE_TEMPLATES) {
  if (!EXAMPLE_BY_ID.has(gen.id)) {
    const desc: ExampleWorkspaceDescriptor = {
      id: gen.id,
      languageId: gen.languageId,
      title: gen.title,
      summary: gen.summary,
      badge: `L${gen.difficulty}`,
      tone: "teal",
      ext: gen.ext,
      primaryFile: gen.primaryFile,
      capabilities: STANDARD_CAPABILITIES,
      files: gen.files,
    };
    EXAMPLE_BY_ID.set(desc.id, desc);
    const list = EXAMPLES_BY_LANGUAGE.get(desc.languageId) ?? [];
    list.push(desc);
    EXAMPLES_BY_LANGUAGE.set(desc.languageId, list);
  }
}

// Legacy/shorthand alias map to verified example IDs
export const TEMPLATE_ALIASES: Record<string, string> = {
  "vehicle-architecture": "sysml2",
  "pendulum-3d": "bouncing-ball",
  "drone-chassis": "drone-reachability",
  cad: "scad-airframe",
  "cad-assembly": "step-pendulum",
  "assembly-to-multibody": "step-pendulum",
  "drone-fea": "fea-chassis",
  "drone-meshing": "fea-chassis",
  "drone-cfd": "cfd-aerodynamics",
  "cfd-verification": "cfd-aerodynamics",
  "owl2-contradiction": "owl2-units",
  "owl2-subsumption": "owl2-units",
  "owl2-fmea": "owl2-units",
  "owl2-manufacturing": "owl2-units",
  "injection-molding-cosim": "ssp-microgrid",
  cosim: "ssp-microgrid",
  "uns-mqtt": "ssp-microgrid",
  surrogate: "modelscript-control",
  "optimica-polyglot": "modelscript-control",
  script: "modelscript-control",
  calibration: "csv-telemetry",
  uncertainty: "drone-reachability",
  "modelica-procedural-cad": "scad-airframe",
  "pelagos-oc8": "pelagos-octopus",
  "octopus-rov": "pelagos-octopus",
  "modelica-pelagos-octopus": "pelagos-octopus",
  notebook: "bouncing-ball",
  "mbse-verification": "reqif-avionics",
};

export function getTemplateFiles(template: string): Record<string, string> {
  if (template === "empty" || template === "blank") {
    return EMPTY_WORKSPACE_FILES;
  }
  const direct = EXAMPLE_BY_ID.get(template);
  if (direct) return direct.files;
  const aliasedId = TEMPLATE_ALIASES[template];
  if (aliasedId) {
    const aliased = EXAMPLE_BY_ID.get(aliasedId);
    if (aliased) return aliased.files;
  }
  // Allow looking up by languageId directly (returns its defaultTemplateId)
  const langTile = LANGUAGE_TILES.find((t) => t.id === template);
  if (langTile) {
    const langEx = EXAMPLE_BY_ID.get(langTile.defaultTemplateId);
    if (langEx) return langEx.files;
  }
  return EMPTY_WORKSPACE_FILES;
}

export function scaffoldTemplateFiles(memFs: IMemoryFileSystemProvider, workspaceUri: vscode.Uri): void {
  const encoder = new TextEncoder();
  const rawTemplate = workspaceUri.path.substring(1) || "empty";
  const template = rawTemplate.split("?")[0] || "empty";

  const isArtifact = template === "scratch" || template.startsWith("artifact-") || /^\d+$/.test(template);
  if (isArtifact) {
    const artifactId =
      template === "scratch"
        ? "scratch"
        : template.startsWith("artifact-")
          ? template.slice("artifact-".length)
          : template;
    const registered = resolveStoredArtifactDescriptor(template, artifactId);
    if (registered) {
      registerArtifactDescriptor(registered);
    }
    const descriptor: ArtifactWorkspaceDescriptor = registered || { artifactId };
    mountArtifactToMemFs(memFs, workspaceUri, descriptor);
    console.log(`[blank-project] Scaffolded artifact file(s) for #${artifactId}`);
    return;
  }

  if (template.startsWith("package-")) {
    const pkgName = decodeURIComponent(template.slice("package-".length));
    const registeredPkg = getPackageDescriptor(pkgName);
    if (registeredPkg) {
      mountArtifactToMemFs(memFs, workspaceUri, registeredPkg);
      return;
    }
    const { files } = generatePackageWorkspaceFiles(pkgName);
    for (const [name, fileContent] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(fileContent));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} package file(s) for '${pkgName}'`);
    return;
  }

  if (template === "stress-test") {
    const massiveModelRows = [];
    massiveModelRows.push('model MassiveModel "A massive model with thousands of elements"');
    for (let i = 0; i < 5000; i++) {
      massiveModelRows.push(`  Real v${i}(start = ${i});`);
    }
    massiveModelRows.push("equation");
    for (let i = 0; i < 4999; i++) {
      massiveModelRows.push(`  der(v${i}) = v${i + 1} - v${i};`);
    }
    massiveModelRows.push(`  der(v4999) = -v4999;`);
    massiveModelRows.push("end MassiveModel;\n");

    const entries: [vscode.Uri, Uint8Array][] = [];
    entries.push([joinPath(workspaceUri, "MassiveModel.mo"), encoder.encode(massiveModelRows.join("\n"))]);

    for (let i = 0; i < 5; i++) {
      const extendsClause = i > 0 ? `:> Component_${String(i - 1).padStart(3, "0")} ` : "";
      const content = `package Component_${String(i).padStart(3, "0")} {\n  part def Component_${String(i).padStart(3, "0")} ${extendsClause}{\n    attribute localValue : Real = ${i}.0;\n  }\n}\n`;
      entries.push([joinPath(workspaceUri, `Component_${String(i).padStart(3, "0")}.sysml`), encoder.encode(content)]);
    }
    if (memFs.writeFiles) {
      memFs.writeFiles(entries);
    } else {
      for (const [uri, data] of entries) {
        memFs.writeFile(uri, data);
      }
    }
    console.log("[blank-project] Scaffolded stress-test workspace files.");
    return;
  }

  const files = getTemplateFiles(template);
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(content));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} template file(s) for '${template}'`);
  }
}

export function getTemplatePrimaryFile(rawTemplate: string): string {
  const template = (rawTemplate || "empty").split("?")[0] || "empty";
  if (template === "empty" || template === "blank") {
    return "";
  }
  if (template === "stress-test") {
    return "MassiveModel.mo";
  }
  const isArtifact = template === "scratch" || template.startsWith("artifact-") || /^\d+$/.test(template);
  if (isArtifact) {
    const artifactId =
      template === "scratch"
        ? "scratch"
        : template.startsWith("artifact-")
          ? template.slice("artifact-".length)
          : template;
    const registered = resolveStoredArtifactDescriptor(template, artifactId);
    if (registered) {
      registerArtifactDescriptor(registered);
      const { primaryFile } = generateArtifactWorkspaceFiles(registered);
      return primaryFile;
    }
    return template === "scratch" ? "ScratchModel.mo" : "ArtifactModel.mo";
  }

  if (template.startsWith("package-")) {
    const pkgName = decodeURIComponent(template.slice("package-".length));
    const { primaryFile } = generatePackageWorkspaceFiles(pkgName);
    return primaryFile;
  }

  const direct = EXAMPLE_BY_ID.get(template);
  if (direct) return direct.primaryFile;

  const aliasedId = TEMPLATE_ALIASES[template];
  if (aliasedId) {
    const aliased = EXAMPLE_BY_ID.get(aliasedId);
    if (aliased) return aliased.primaryFile;
  }

  const langTile = LANGUAGE_TILES.find((t) => t.id === template);
  if (langTile) {
    const langEx = EXAMPLE_BY_ID.get(langTile.defaultTemplateId);
    if (langEx) return langEx.primaryFile;
  }

  return "";
}
