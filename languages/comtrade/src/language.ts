// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript COMTRADE Language Definition.
 */

import { cardDeckRules, language } from "@modelscript/dsl";
import { extractPhasorAtTimestamp } from "./analysis/phasor-extractor.js";
import { lowerComtradeToDae } from "./dae/comtrade-to-dae.js";
import { canIndexComtrade, indexComtradeDocument } from "./indexing.js";
import { lintComtradeRecord } from "./lints/index.js";
import { parseComfede } from "./parser/comfede.js";
import { crossCheckComnameWithComtrade, validateComname } from "./parser/comname.js";
import { parseComtradeCff, parseComtradeCfg } from "./parser/comtrade-reader.js";
import { writeComtradeCff } from "./parser/comtrade-writer.js";
import { comtradePolyglotConfig } from "./tgg/index.js";
import type { ComtradeRecord } from "./types.js";

export const comtradeLanguage = language({
  polyglot: comtradePolyglotConfig,
  name: "comtrade",
  fileExtensions: [".cfg", ".dat", ".cff", ".soe", ".comfede"],
  maturity: "beta",
  indexing: {
    indexFile: indexComtradeDocument,
    canIndex: canIndexComtrade,
  },
  lsp: {
    fileExtensions: [".cfg", ".dat", ".cff", ".soe", ".comfede"],
  },

  ui: {
    toolbarButtons: [
      {
        id: "extractComtradePhasor",
        label: "Extract Dynamic Phasor (COMTRADE)",
        shortLabel: "Extract Dynamic",
        tooltip: "Extract Dynamic Phasor (COMTRADE)",
        icon: "pulse",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        actionId: "extract_comtrade_phasor",
      },
      {
        id: "parseComfedeSoe",
        label: "Parse IEEE C37.239 COMFEDE (SOE)",
        shortLabel: "Parse IEEE",
        tooltip: "Parse IEEE C37.239 COMFEDE (SOE)",
        icon: "table",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "parse_comfede_soe",
      },
      {
        id: "validateComname",
        label: "Validate IEEE C37.232 COMNAME Filename",
        shortLabel: "Validate IEEE",
        tooltip: "Validate IEEE C37.232 COMNAME Filename",
        icon: "shield-check",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "validate_comname",
      },
      {
        id: "lowerComtradeDae",
        label: "Lower COMTRADE Record to DAE Arena",
        shortLabel: "Lower COMTRADE",
        tooltip: "Lower COMTRADE Record to DAE Arena",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "lower_comtrade_dae",
      },
      {
        id: "exportComtradeCff",
        label: "Export COMTRADE Common File Format (.cff)",
        shortLabel: "Export COMTRADE",
        tooltip: "Export COMTRADE Common File Format (.cff)",
        icon: "download",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "export_comtrade_cff",
      },
      {
        id: "lintComtradeRecord",
        label: "Lint COMTRADE Disturbance Record",
        shortLabel: "Lint COMTRADE",
        tooltip: "Lint COMTRADE Disturbance Record",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "lint_comtrade_record",
      },
    ],
  },
  actions: [
    {
      id: "extract_comtrade_phasor",
      title: "Extract Dynamic Phasor (COMTRADE)",
      description: "Applies sliding Discrete Fourier Transform (DFT) to compute RMS magnitude and phase angle.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "comtrade_extract_phasor",
          displayName: "Extract Phasor from COMTRADE Waveform",
          modelDescription:
            "Computes RMS magnitude and phase angle using sliding 1-cycle DFT on a COMTRADE analog channel.",
        },
      },
      execute: async (
        ctx,
        params?: {
          documentText?: string | undefined;
          channelIndex?: number | undefined;
          timestamp?: number | undefined;
          fundamentalHz?: number | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        let record: ComtradeRecord;
        if (text.includes("--- file type: CFG ---")) {
          record = parseComtradeCff(text);
        } else {
          const cfg = parseComtradeCfg(text);
          const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
          const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
          record = {
            config: cfg,
            cfg,
            timeSec: new Float64Array(0),
            analogData: analogList.map(() => []),
            digitalData: digitalList.map(() => []),
            timestamps: [],
          };
        }
        const chIdx = params?.channelIndex ?? 0;
        const ts = params?.timestamp ?? 0;
        const f0 = params?.fundamentalHz ?? record.config?.lineFrequencyHz ?? record.cfg?.nominalFrequency ?? 60.0;
        return extractPhasorAtTimestamp(record, chIdx, ts, f0);
      },
    },
    {
      id: "lint_comtrade_record",
      title: "Lint COMTRADE Disturbance Record",
      description: "Checks IEEE C37.111 COMTRADE record for schema, timestamp monotonicity, and range integrity.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        let record: ComtradeRecord;
        if (text.includes("--- file type: CFG ---")) {
          record = parseComtradeCff(text);
        } else {
          const cfg = parseComtradeCfg(text);
          const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
          const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
          record = {
            config: cfg,
            cfg,
            timeSec: new Float64Array(0),
            analogData: analogList.map(() => []),
            digitalData: digitalList.map(() => []),
            timestamps: [],
          };
        }
        return lintComtradeRecord(record);
      },
    },
    {
      id: "lower_comtrade_dae",
      title: "Lower COMTRADE Record to DAE Arena",
      description:
        "Compiles recorded analog & digital signals into zero-GC linear memory DAEBuilder arena for hardware playback.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        let record: ComtradeRecord;
        if (text.includes("--- file type: CFG ---")) {
          record = parseComtradeCff(text);
        } else {
          const cfg = parseComtradeCfg(text);
          const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
          const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
          record = {
            config: cfg,
            cfg,
            timeSec: new Float64Array([0, 0.001]),
            analogData: analogList.map(() => [0, 0]),
            digitalData: digitalList.map(() => [0, 0]),
            timestamps: [0, 0.001],
          };
        }
        const dae = lowerComtradeToDae(record);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "export_comtrade_cff",
      title: "Export COMTRADE Common File Format (.cff)",
      description: "Bundles .cfg and .dat records into a single IEEE C37.111-2013 CFF file.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        let record: ComtradeRecord;
        if (text.includes("--- file type: CFG ---")) {
          record = parseComtradeCff(text);
        } else {
          const cfg = parseComtradeCfg(text);
          const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
          const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
          record = {
            config: cfg,
            cfg,
            timeSec: new Float64Array(0),
            analogData: analogList.map(() => []),
            digitalData: digitalList.map(() => []),
            timestamps: [],
          };
        }
        return writeComtradeCff(record);
      },
    },
    {
      id: "parse_comfede_soe",
      title: "Parse IEEE C37.239 COMFEDE (SOE)",
      description: "Parses an IEEE C37.239 COMFEDE XML or CSV/ASCII sequence-of-events document.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return parseComfede(text);
      },
    },
    {
      id: "validate_comname",
      title: "Validate IEEE C37.232 COMNAME Filename",
      description: "Validates an IEEE C37.232 COMNAME filename and cross-checks against COMTRADE .cfg metadata.",
      category: "verify",
      execute: async (ctx, params?: { fileName?: string | undefined; documentText?: string | undefined }) => {
        const fileName = params?.fileName ?? "";
        const validation = validateComname(fileName);
        const text = params?.documentText ?? ctx?.documentText;
        if (validation.valid && validation.components && text) {
          try {
            const cfg = parseComtradeCfg(text);
            const warnings = crossCheckComnameWithComtrade(validation.components, cfg);
            return { ...validation, warnings };
          } catch {
            return validation;
          }
        }
        return validation;
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default comtradeLanguage;
