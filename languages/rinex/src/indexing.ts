// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rinex — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes RINEX v2 OBS & NAV files into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { formatRinexTimestamp, parseRinex } from "./parser/index.js";

export const rinexIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".obs") || lower.endsWith(".nav") || lower.endsWith(".rnx") || /\.\d{2}[on]$/.test(lower)) {
      return true;
    }
    if (!text) return false;
    return text.includes("RINEX VERSION / TYPE") || text.includes("END OF HEADER");
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseRinex(ctx.text);
    ctx.setParsedModel(doc);

    const rootName = doc.header.markerName || (doc.fileType === "N" ? "RINEX_NAV" : "RINEX_OBS");
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        fileType: doc.fileType,
        version: doc.header.version,
      },
      {
        ruleName: "rinexDocument",
        namePath: rootName,
      },
    );

    const seenPrns = new Set<string>();
    for (const epoch of doc.epochs) {
      const label = formatRinexTimestamp(epoch.timestamp);
      ctx.addSymbol(
        `Epoch ${label}`,
        "Class",
        rootId,
        0,
        0,
        {
          epochLine: epoch.line,
          numSatellites: epoch.satellites.length,
        },
        {
          ruleName: "obsEpoch",
          namePath: `${rootName}.${label}`,
        },
      );
      for (const sat of epoch.satellites) {
        if (!seenPrns.has(sat.prn)) {
          seenPrns.add(sat.prn);
          ctx.addSymbol(
            sat.prn,
            "Component",
            rootId,
            0,
            0,
            { prn: sat.prn, system: sat.system },
            { ruleName: "satellite", namePath: `${rootName}.${sat.prn}` },
          );
        }
      }
    }

    for (const ephem of doc.ephemerides) {
      const tocLabel = formatRinexTimestamp(ephem.toc);
      ctx.addSymbol(
        `${ephem.prn} (${tocLabel})`,
        "Class",
        rootId,
        0,
        0,
        { prn: ephem.prn, toe: ephem.toe, iode: ephem.iode },
        {
          ruleName: "navEphemeris",
          namePath: `${rootName}.${ephem.prn}`,
          aliases: [ephem.prn],
        },
      );
    }
  },
};
