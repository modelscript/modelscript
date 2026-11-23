// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gerber — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Gerber RS-274-D & RS-274X PCB photoplotter files into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGerber } from "./parser/gerber-parser.js";

const GERBER_EXTENSIONS = [
  ".gbr",
  ".ger",
  ".gtl",
  ".gbl",
  ".gts",
  ".gbs",
  ".gto",
  ".gbo",
  ".gtp",
  ".gbp",
  ".gko",
  ".gm1",
  ".g1",
  ".g2",
  ".art",
  ".pho",
];

export const gerberIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (GERBER_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    return /%FS[LT][AI]X\d\dY\d\d\*%/.test(text) || (/%MO(IN|MM)\*%/.test(text) && /M02\*/.test(text));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseGerber(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      doc.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        unit: doc.unit ?? "MM",
        apertureCount: doc.apertures.size,
        macroCount: doc.macros.size,
      },
      {
        ruleName: "gerber_layer",
        namePath: "name",
      },
    );

    for (const [dCode, ap] of doc.apertures) {
      ctx.addSymbol(
        `D${dCode}`,
        "Component",
        rootId,
        ap.startOffset,
        ap.endOffset,
        {
          dCode,
          shape: ap.shape,
          width: ap.width,
          height: ap.height,
          holeDiameter: ap.holeDiameter ?? 0,
        },
        {
          ruleName: "aperture_definition",
          namePath: "name",
          aliases: [`D${dCode}`, `ADD${dCode}`],
        },
      );
    }

    for (const [macroName, macro] of doc.macros) {
      ctx.addSymbol(
        macroName,
        "Class",
        rootId,
        macro.startOffset,
        macro.endOffset,
        {
          primitiveCount: macro.primitives.length,
        },
        {
          ruleName: "aperture_macro",
          namePath: "name",
        },
      );
    }
  },
};
