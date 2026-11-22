// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Multi-File SysML v2 Workspace Migration Engine.
 *
 * Splits large MagicDraw / Cameo SysML 1.x `.mdzip` projects into a clean,
 * modular multi-file OMG SysML v2 workspace (one `.sysml` file per top-level package)
 * with `private import` statements, multiplicities, QUDV unit annotations,
 * `NestedConnectorEnd` deep paths, and a structured `MigrationReport`.
 */

import { parseMagicDraw } from "../parser/index.js";
import type { MagicDrawDocument, UmlPackage } from "../types.js";
import { magicDrawToSysml2 } from "./sysml2.js";

export interface MigratedSysmlFile {
  fileName: string;
  packageName: string;
  content: string;
}

export interface Sysml2MigrationReport {
  projectName: string;
  filesWritten: number;
  packagesMigrated: number;
  blocksMigrated: number;
  requirementsMigrated: number;
  constraintsMigrated: number;
  stateMachinesMigrated: number;
  warnings: string[];
}

export interface Sysml2MigrationWorkspace {
  files: MigratedSysmlFile[];
  report: Sysml2MigrationReport;
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_");
  return cleaned || "Model";
}

function collectPackageSubtreeIds(pkg: UmlPackage, doc: MagicDrawDocument, out: Set<string>): void {
  out.add(pkg.id);
  for (const cid of pkg.classifierIds) out.add(cid);
  for (const smId of pkg.stateMachineIds) out.add(smId);
  for (const childId of pkg.childPackageIds) {
    const ch = doc.packages.get(childId);
    if (ch) collectPackageSubtreeIds(ch, doc, out);
  }
}

/**
 * Migrates a MagicDraw `.mdzip` / `.mdxml` / `.xmi` document into a multi-file
 * OMG SysML v2 workspace with per-package `.sysml` files and a migration report.
 */
export function migrateMagicDrawToSysml2Workspace(
  docOrInput: MagicDrawDocument | string | Uint8Array,
): Sysml2MigrationWorkspace {
  const doc =
    typeof docOrInput === "string" || docOrInput instanceof Uint8Array ? parseMagicDraw(docOrInput) : docOrInput;

  const warnings: string[] = [];
  const rootPkg = doc.rootPackageId ? doc.packages.get(doc.rootPackageId) : undefined;
  const splitPackages: UmlPackage[] = [];

  if (rootPkg && rootPkg.childPackageIds.length > 0) {
    for (const childId of rootPkg.childPackageIds) {
      const ch = doc.packages.get(childId);
      if (ch) splitPackages.push(ch);
    }
  } else {
    for (const pkg of doc.packages.values()) {
      if (!pkg.ownerId) splitPackages.push(pkg);
    }
  }

  const files: MigratedSysmlFile[] = [];
  const usedNames = new Set<string>();

  if (splitPackages.length <= 1) {
    const baseName = sanitizeFileName(doc.metadata.projectName ?? splitPackages[0]?.name ?? "Model");
    files.push({
      fileName: `${baseName}.sysml`,
      packageName: splitPackages[0]?.name ?? baseName,
      content: magicDrawToSysml2(doc),
    });
  } else {
    const pkgByElementId = new Map<string, string>();
    for (const pkg of splitPackages) {
      const ids = new Set<string>();
      collectPackageSubtreeIds(pkg, doc, ids);
      for (const id of ids) pkgByElementId.set(id, pkg.name);
    }

    for (const pkg of splitPackages) {
      const subIds = new Set<string>();
      collectPackageSubtreeIds(pkg, doc, subIds);

      // Detect cross-package type imports
      const imports = new Set<string>();
      for (const id of subIds) {
        const cls = doc.classifiers.get(id);
        if (!cls) continue;
        for (const prop of cls.properties) {
          const tId = prop.typeRef?.resolvedId;
          if (tId && !subIds.has(tId)) {
            const ownerPkg = pkgByElementId.get(tId);
            if (ownerPkg && ownerPkg !== pkg.name) imports.add(ownerPkg);
          }
        }
        for (const pt of cls.ports) {
          const tId = pt.typeRef?.resolvedId;
          if (tId && !subIds.has(tId)) {
            const ownerPkg = pkgByElementId.get(tId);
            if (ownerPkg && ownerPkg !== pkg.name) imports.add(ownerPkg);
          }
        }
      }

      // Build a scoped sub-document for this package
      const subPackages = new Map<string, UmlPackage>();
      for (const [pid, p] of doc.packages) {
        if (subIds.has(pid)) {
          subPackages.set(pid, pid === pkg.id ? { ...p, ownerId: undefined } : p);
        }
      }
      const subDoc: MagicDrawDocument = {
        ...doc,
        rootPackageId: pkg.id,
        packages: subPackages,
      };

      let content = magicDrawToSysml2(subDoc);
      if (imports.size > 0) {
        const importBlock = Array.from(imports)
          .sort()
          .map((imp) => `  private import ${imp.trim().replace(/[^A-Za-z0-9_]/g, "_")}::*;`)
          .join("\n");
        const firstBrace = content.indexOf("{");
        if (firstBrace >= 0) {
          content = `${content.slice(0, firstBrace + 1)}\n${importBlock}\n${content.slice(firstBrace + 1)}`;
        }
      }

      let baseFile = sanitizeFileName(pkg.name);
      let suffix = 2;
      while (usedNames.has(baseFile.toLowerCase())) {
        baseFile = `${sanitizeFileName(pkg.name)}_${suffix++}`;
      }
      usedNames.add(baseFile.toLowerCase());

      files.push({
        fileName: `${baseFile}.sysml`,
        packageName: pkg.name,
        content,
      });
    }
  }

  if (doc.activities.size > 0) {
    warnings.push(
      `${doc.activities.size} UML Activity definition(s) detected; verify action flow control nodes after migration.`,
    );
  }
  if (doc.unresolvedHrefs.length > 0) {
    warnings.push(`${doc.unresolvedHrefs.length} external href(s) could not be resolved during migration.`);
  }

  const allClassifiers = Array.from(doc.classifiers.values());
  return {
    files,
    report: {
      projectName: doc.metadata.projectName ?? "MagicDrawModel",
      filesWritten: files.length,
      packagesMigrated: doc.packages.size,
      blocksMigrated: allClassifiers.filter((c) => c.kind === "Block" || c.kind === "InterfaceBlock").length,
      requirementsMigrated: allClassifiers.filter((c) => c.kind === "Requirement").length,
      constraintsMigrated: allClassifiers.filter((c) => c.kind === "ConstraintBlock").length,
      stateMachinesMigrated: doc.stateMachines.size,
      warnings,
    },
  };
}
