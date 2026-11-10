// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Radio Access Network (RAN), NSMA WG16.99.050 (.adf/.nsma), and Planet (.msi/.planet) Language Definition.
 */

import { language } from "@modelscript/dsl";
import { DAEBuilder } from "@modelscript/runtime";
import { lowerRanLinkToDae } from "./dae/lowering.js";
import { lintAntennaPatternDeck } from "./lints/ran-linter.js";
import { parseNsmaAdf } from "./parser/nsma-parser.js";
import { parsePlanetPat } from "./parser/planet-parser.js";

export const ranLanguage = language({
  name: "ran",
  fileExtensions: [".adf", ".nsma", ".msi", ".planet"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".adf", ".nsma", ".msi", ".planet"],
  },

  actions: [
    {
      id: "ran_lint",
      title: "Lint Antenna Pattern Deck",
      description: "Validates NSMA WG16.99.050 (.adf/.nsma) and Planet (.msi/.planet) antenna radiation patterns.",
      category: "verify",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const isNsma = text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:");
        const deck = isNsma ? parseNsmaAdf(text) : parsePlanetPat(text);
        return lintAntennaPatternDeck(deck);
      },
    },
    {
      id: "ran_to_dae",
      title: "Lower RAN Link Budget to DAE",
      description: "Lowers ITU-R P.530 microwave/5G RF link budget and Shannon capacity equations into DAEBuilder.",
      category: "transform",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        const isNsma = text ? text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:") : true;
        const deck = text ? (isNsma ? parseNsmaAdf(text) : parsePlanetPat(text)) : null;
        const builder = new DAEBuilder(undefined, deck?.model || "RanLinkBudget");
        const freqMhz = deck?.nominalFrequencyMhz ?? (deck ? deck.frequencyRangeMhz[0] : 18000);
        const res = lowerRanLinkToDae(builder, {
          id: deck?.model || "link_1",
          txSiteName: "Site_A",
          rxSiteName: "Site_B",
          frequencyGhz: freqMhz > 0 ? freqMhz / 1000 : 18.0,
          pathLengthKm: 10.0,
          txPowerDbm: 23.0,
          txAntennaGainDbi: deck?.peakGainDbi || 38.0,
          txFeederLossDb: 1.5,
          rxAntennaGainDbi: deck?.peakGainDbi || 38.0,
          rxFeederLossDb: 1.5,
          requiredMarginDb: 20.0,
          polarization: deck?.polarization === "H" ? "H" : "V",
        });
        return {
          modelName: deck?.model || "RanLinkBudget",
          variableCount: builder.getVarCount(),
          equationCount: res.equationCount,
        };
      },
    },
  ],
});

export default ranLanguage;
