// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/asn1 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes ISO/ITU-T X.208 / X.680 ASN.1 modules (.asn, .asn1, .mib) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseAsn1 } from "./parser/asn1-parser.js";

export const asn1Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".asn") || lower.endsWith(".asn1") || lower.endsWith(".mib")) {
      return true;
    }
    if (!text) return false;
    return /\bDEFINITIONS\b[\s\S]*::=\s*BEGIN\b/.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const mod = parseAsn1(ctx.text);
    ctx.setParsedModel(mod);

    const modRootId = ctx.addSymbol(
      mod.name,
      "Module",
      null,
      mod.span.startOffset,
      mod.span.endOffset,
      { kind: "asn1-module", tagDefault: mod.tagDefault },
      { ruleName: "ModuleDefinition", namePath: "name" },
    );

    for (const t of mod.types) {
      const symKind =
        t.type.kind === "enumerated"
          ? "Enum"
          : t.type.kind === "sequence" || t.type.kind === "set" || t.type.kind === "choice"
            ? "Struct"
            : "TypeAlias";

      const typeId = ctx.addSymbol(
        t.name,
        symKind,
        modRootId,
        t.span.startOffset,
        t.span.endOffset,
        { kind: t.type.kind },
        { ruleName: "TypeAssignment", namePath: "name" },
      );

      if (t.type.kind === "sequence" || t.type.kind === "set") {
        for (const f of t.type.fields) {
          ctx.addSymbol(
            f.name,
            "Field",
            typeId,
            f.span.startOffset,
            f.span.endOffset,
            { optional: f.optional, tag: f.tag?.number },
            { ruleName: "ComponentType", namePath: "name" },
          );
        }
      } else if (t.type.kind === "choice") {
        for (const alt of t.type.alternatives) {
          ctx.addSymbol(
            alt.name,
            "Field",
            typeId,
            alt.span.startOffset,
            alt.span.endOffset,
            { alternative: true, tag: alt.tag?.number },
            { ruleName: "ComponentType", namePath: "name" },
          );
        }
      } else if (t.type.kind === "enumerated") {
        for (const item of t.type.items) {
          ctx.addSymbol(
            item.name,
            "EnumMember",
            typeId,
            item.span.startOffset,
            item.span.endOffset,
            { value: item.value },
            { ruleName: "NamedNumber", namePath: "name" },
          );
        }
      }
    }

    for (const v of mod.values) {
      ctx.addSymbol(
        v.name,
        "Constant",
        modRootId,
        v.span.startOffset,
        v.span.endOffset,
        { rawValue: v.rawValue, oidArcs: v.oidArcs },
        { ruleName: "ValueAssignment", namePath: "name" },
      );
    }
  },
};
