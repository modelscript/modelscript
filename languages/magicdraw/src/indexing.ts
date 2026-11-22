// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes MagicDraw / Cameo (.mdzip, .mdxml, .xmi) Packages, Blocks, Ports,
 * Properties, Requirements, ConstraintBlocks, StateMachines, and Diagrams.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseMagicDraw } from "./parser/index.js";
import type { MagicDrawDocument } from "./types.js";

function deriveProjectNameFromUri(uri: string): string {
  const filename = uri.split(/[\\/]/).pop() || "model.mdzip";
  return filename.replace(/\.(mdzip|mdxml|xmi)$/i, "");
}

export const magicDrawIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".mdzip") || lower.endsWith(".mdxml") || lower.endsWith(".xmi")) return true;
    return Boolean(text && (text.includes("<xmi:XMI") || text.includes("xmlns:xmi=") || text.includes("magicdraw")));
  },

  indexFile(ctx: DslIndexFileContext): void {
    let doc: MagicDrawDocument;
    try {
      doc = parseMagicDraw(ctx.text);
      ctx.setParsedModel(doc);
    } catch {
      return;
    }

    if (doc.metadata.status !== "ok") return;

    const projectTitle = doc.metadata.projectName || deriveProjectNameFromUri(ctx.uri);
    const pkgSymMap = new Map<string, number>();

    // Index packages
    const rootPkg = doc.rootPackageId ? doc.packages.get(doc.rootPackageId) : undefined;
    const rootSymId = ctx.addSymbol(
      rootPkg?.name || projectTitle,
      "Package",
      null,
      rootPkg?.span?.startOffset ?? 0,
      rootPkg?.span?.endOffset ?? ctx.text.length,
      {
        language: "magicdraw",
        format: doc.metadata.format,
        magicDrawVersion: doc.metadata.magicDrawVersion,
        classifierCount: doc.classifiers.size,
        diagramCount: doc.diagrams.length,
      },
      {
        ruleName: "magicdraw_model",
        namePath: rootPkg?.qualifiedName || projectTitle,
      },
    );
    if (rootPkg) pkgSymMap.set(rootPkg.id, rootSymId);

    for (const pkg of doc.packages.values()) {
      if (pkg.id === rootPkg?.id) continue;
      const parentSymId = (pkg.ownerId ? pkgSymMap.get(pkg.ownerId) : undefined) ?? rootSymId;
      const symId = ctx.addSymbol(
        pkg.name,
        "Package",
        parentSymId,
        pkg.span?.startOffset ?? 0,
        pkg.span?.endOffset ?? 0,
        {
          language: "magicdraw",
          xmiId: pkg.id,
        },
        {
          ruleName: "magicdraw_package",
          namePath: pkg.qualifiedName,
        },
      );
      pkgSymMap.set(pkg.id, symId);
    }

    // Index classifiers (Blocks, Requirements, ValueTypes, ConstraintBlocks, etc.)
    for (const cls of doc.classifiers.values()) {
      const parentSymId = pkgSymMap.get(cls.ownerId) ?? rootSymId;
      const ruleName =
        cls.kind === "Requirement"
          ? "magicdraw_requirement"
          : cls.kind === "ConstraintBlock"
            ? "magicdraw_constraint_block"
            : "magicdraw_block";

      const clsSymId = ctx.addSymbol(
        cls.name,
        "Class",
        parentSymId,
        cls.span?.startOffset ?? 0,
        cls.span?.endOffset ?? 0,
        {
          language: "magicdraw",
          xmiId: cls.id,
          classifierKind: cls.kind,
          stereotypes: cls.stereotypes.map((s) => s.name),
          ...(cls.requirementId ? { identifier: cls.requirementId } : {}),
          ...(cls.requirementText ? { text: cls.requirementText } : {}),
          ...(cls.unit ? { unit: cls.unit } : {}),
        },
        {
          ruleName,
          namePath: cls.qualifiedName,
          aliases: cls.requirementId && cls.requirementId !== cls.name ? [cls.requirementId] : [],
        },
      );

      for (const prop of cls.properties) {
        ctx.addSymbol(
          prop.name,
          "Component",
          clsSymId,
          prop.span?.startOffset ?? 0,
          prop.span?.endOffset ?? 0,
          {
            language: "magicdraw",
            xmiId: prop.id,
            compartment: prop.compartment,
            typeName: prop.typeRef?.resolvedName,
            unit: prop.typeRef?.unit,
          },
          {
            ruleName: "magicdraw_property",
            namePath: `${cls.qualifiedName}::${prop.name}`,
          },
        );
      }

      for (const port of cls.ports) {
        ctx.addSymbol(
          port.name,
          "Component",
          clsSymId,
          port.span?.startOffset ?? 0,
          port.span?.endOffset ?? 0,
          {
            language: "magicdraw",
            xmiId: port.id,
            portKind: port.portKind,
            isConjugated: port.isConjugated,
            typeName: port.typeRef?.resolvedName,
          },
          {
            ruleName: "magicdraw_port",
            namePath: `${cls.qualifiedName}::${port.name}`,
          },
        );
      }
    }

    // Index state machines
    for (const sm of doc.stateMachines.values()) {
      const parentSymId = pkgSymMap.get(sm.ownerId) ?? rootSymId;
      ctx.addSymbol(
        sm.name,
        "Class",
        parentSymId,
        sm.span?.startOffset ?? 0,
        sm.span?.endOffset ?? 0,
        {
          language: "magicdraw",
          xmiId: sm.id,
          stateCount: sm.states.length,
          transitionCount: sm.transitions.length,
        },
        {
          ruleName: "magicdraw_statemachine",
          namePath: sm.qualifiedName,
        },
      );
    }
  },
};
