// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  language,
  repeat,
  repeat1,
  seq,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { buildPsseBuiltinSymbols, indexPsseDocument } from "./builtins.js";
import { registerBuiltInPsseLibrarySync } from "./catalog/wasm-dyr-loader.js";
import { auditNercCompliance } from "./compliance/nerc-auditor.js";
import { lintPsse } from "./lints/index.js";
import { extractPowerFlowNetlist, serializePowerFlowNetlist } from "./netlist/powerflow-netlist.js";
import { psseOutStreamCodecDef, psseSavSoaCodecDef, readPsseOutWindow } from "./parser/codecs.js";
import { executeIdv } from "./parser/idv-interpreter.js";
import { parseRaw } from "./parser/raw-parser.js";
import { parsePsseOut, serializePsseSav } from "./parser/sav-parser.js";
import { psseToModelica } from "./projections/psse-to-modelica.js";
import { psseToEmtNetlist } from "./projections/psse-to-pscad.js";
import { executePythonPsspyScript } from "./psspy-shim.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  formatPowerFlowReport,
  simulatePsseTransient,
  solvePowerFlow,
} from "./solver/ac-powerflow.js";
import { calculateGic } from "./solver/gic-solver.js";
import { pssePolyglotConfig } from "./tgg.js";

/**
 * ModelScript PSS/E RAW (`.raw`), DYR (`.dyr`), SEQ (`.seq`), CON/MON/SUB, IDV & SAV/OUT Language Definition.
 *
 * Provides declarative grammar, multi-format dialect registry, binary-to-SoA WASM codecs,
 * linear CST queries, pre-flight grid linter, AC power flow, multi-machine transient stability
 * simulation, and Ybus netlist extraction.
 */
export const psseLanguage = language({
  name: "psse",
  fileExtensions: [".raw", ".dyr", ".seq", ".con", ".mon", ".sub", ".idv", ".sav", ".out"],
  formats: {
    raw: {
      kind: "text",
      fileExtensions: [".raw"],
      startRule: "RawFile",
      versions: [26, 29, 30, 31, 32, 33, 34, 35, 36],
      description: "PSS/E ASCII Power Flow Raw Data File (v26–v36).",
    },
    dyr: {
      kind: "text",
      fileExtensions: [".dyr"],
      startRule: "DyrFile",
      versions: [26, 29, 30, 31, 32, 33, 34, 35, 36],
      description: "PSS/E Dynamic Model Data File.",
    },
    seq: {
      kind: "text",
      fileExtensions: [".seq"],
      startRule: "SeqFile",
      versions: [30, 31, 32, 33, 34, 35, 36],
      description: "PSS/E Positive-, Negative-, and Zero-Sequence Impedance Data File.",
    },
    con: {
      kind: "text",
      fileExtensions: [".con", ".mon", ".sub"],
      startRule: "ConFile",
      description: "PSS/E ACCC Contingency, Monitored Element, and Subsystem Definitions.",
    },
    idv: {
      kind: "text",
      fileExtensions: [".idv"],
      startRule: "IdvFile",
      description: "PSS/E Interactive Batch & Macro Command Script.",
    },
    sav: {
      kind: "binary",
      fileExtensions: [".sav"],
      codec: psseSavSoaCodecDef,
      versions: [26, 29, 30, 31, 32, 33, 34, 35, 36],
      description: "PSS/E Binary Saved Case Snapshot (SoA WASM codec).",
    },
    out: {
      kind: "binary",
      fileExtensions: [".out"],
      codec: psseOutStreamCodecDef,
      versions: [33, 34, 35, 36],
      description: "PSS/E Binary Dynamic Channel Output (streaming & O(1) seekable WASM codec).",
    },
  },
  maturity: "stable",
  indexing: {
    builtins: buildPsseBuiltinSymbols,
    indexFile: indexPsseDocument,
  },
  lsp: {
    fileExtensions: [".raw", ".dyr", ".seq", ".con", ".mon", ".sub", ".idv", ".sav", ".out"],
    icons: {
      light: "./assets/psse/icon-light.png",
      dark: "./assets/psse/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "rawEditor",
        viewType: "modelscript.rawEditor",
        title: "PSS/E Grid & Single-Line Diagram (SLD) Editor",
        shortTitle: "Grid & SLD",
        selector: ["*.raw"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/PssePanel.tsx",
        artifactViewTypes: ["psse", "raw", "powerflow", "sld"],
        openCommand: {
          id: "modelscript.openRawWorkbench",
          title: "Open PSS/E Grid Workbench",
          icon: "$(circuit-board)",
        },
      },
    ],
    stencils: [
      { label: "Bus Record", snippet: "   99, 'BUS_NEW     ', 138.0000,1,   1,   1,   1,1.00000,   0.0000\n" },
      {
        label: "Load Record",
        snippet: "   99,'1 ',1,   1,   1,    50.000,    15.000,     0.000,     0.000,     0.000,     0.000,   1,1,0\n",
      },
    ],
    toolbarButtons: [
      {
        id: "solvePowerFlow",
        label: "Solve AC Power Flow (Newton-Raphson)",
        shortLabel: "Power Flow",
        tooltip: "Solve steady-state AC power flow for the active PSS/E case",
        icon: "pulse",
        views: ["diagram", "inspector"],
        targets: ["morsel", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "solve_powerflow",
      },
      {
        id: "n1Contingencies",
        label: "Run N-1 Contingency Analysis",
        tooltip: "Evaluate N-1 line and transformer outage contingencies",
        icon: "shield-check",
        views: ["diagram", "inspector"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 20,
        actionId: "analyze_n1_contingencies",
      },
      {
        id: "shortCircuit",
        label: "Run Short-Circuit Fault Analysis (IEC 60909 / ANSI C37)",
        shortLabel: "Fault",
        tooltip: "Run Short-Circuit Fault Analysis (IEC 60909 / ANSI C37)",
        icon: "zap",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "solve_short_circuit",
      },
      {
        id: "gicTpl007",
        label: "Calculate Geomagnetically Induced Currents (GIC) & NERC TPL-007 Compliance",
        shortLabel: "GIC",
        tooltip: "Calculate Geomagnetically Induced Currents (GIC) & NERC TPL-007 Compliance",
        icon: "pulse",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 35,
        actionId: "calculate_gic_tpl007",
      },
      {
        id: "exportModelica",
        label: "Project to Modelica Power Grid (.mo)",
        shortLabel: "Modelica",
        tooltip: "Project to Modelica Power Grid (.mo)",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "export_psse_modelica",
      },
      {
        id: "nercAudit",
        label: "Audit NERC Reliability Compliance (MOD-025/026/027 & TPL-001)",
        shortLabel: "NERC Audit",
        tooltip: "Audit NERC Reliability Compliance (MOD-025/026/027 & TPL-001)",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 45,
        actionId: "audit_nerc_compliance",
      },
    ],
  },

  // Surgical writeback for cell and attribute mutations
  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
  },

  actions: [
    {
      id: "simulate_psse_transient",
      title: "Simulate Transient Stability (Multi-Machine)",
      description: "Runs multi-machine electro-mechanical transient stability simulation with fault disturbance.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "psse_simulate_transient",
          displayName: "Simulate PSS/E Transient Stability",
          modelDescription:
            "Simulates multi-machine electro-mechanical rotor angle, frequency, and bus voltage transient response.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined; stopTime?: number | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return simulatePsseTransient(parsed, { stopTime: params?.stopTime });
      },
    },
    {
      id: "solve_powerflow",
      title: "Solve AC Power Flow (Newton-Raphson)",
      description: "Solves steady-state AC power flow equations and generates a full bus & branch flow report.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "psse_solve_powerflow",
          displayName: "Solve PSS/E AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a PSS/E base case.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        const sol = solvePowerFlow(parsed);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, caseTitle),
        };
      },
    },
    {
      id: "analyze_n1_contingencies",
      title: "Run N-1 Contingency Security Screening",
      description:
        "Screens single-element line, transformer, and generator outages for thermal overloads and voltage violations.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(shield)",
          group: "navigation@2",
        },
        languageModelTool: {
          name: "psse_analyze_n1_contingencies",
          displayName: "Run PSS/E N-1 Contingency Analysis",
          modelDescription: "Screens N-1 transmission and generator contingencies for thermal and voltage violations.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return analyzeN1Contingencies(parsed);
      },
    },
    {
      id: "solve_short_circuit",
      title: "Run Short-Circuit Fault Analysis (IEC 60909 / ANSI C37)",
      description:
        "Computes symmetrical 3-phase, 1LG, 2L, and 2LG fault currents and short-circuit MVA across all buses.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(zap)",
          group: "navigation@2",
        },
        languageModelTool: {
          name: "psse_solve_short_circuit",
          displayName: "Run PSS/E Short-Circuit Fault Analysis",
          modelDescription: "Computes 3-phase, 1LG, 2L, and 2LG short-circuit fault currents and MVA across all buses.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return calculateShortCircuit(parsed);
      },
    },
    {
      id: "extract_powerflow_netlist",
      title: "Extract Power Flow Netlist & Ybus",
      description: "Extracts nodal admittance matrix (Ybus), power injections, and voltage bounds.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(circuit-board)",
          group: "navigation@3",
        },
        languageModelTool: {
          name: "psse_extract_netlist",
          displayName: "Extract Power Flow Netlist",
          modelDescription: "Computes complex admittance matrix and power injections for PSS/E base case.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        const netlist = extractPowerFlowNetlist(parsed);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return serializePowerFlowNetlist(netlist, caseTitle);
      },
    },
    {
      id: "lint_psse_case",
      title: "Lint PSS/E Base Case",
      description: "Performs pre-flight electrical topology, boundary, and parameter bounds checks.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@3",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "psse_lint",
          displayName: "Lint PSS/E Case",
          modelDescription: "Lints PSS/E raw file for missing buses, limits, and topology errors.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseRaw(text);
        return lintPsse(parsed);
      },
    },
    {
      id: "export_psse_modelica",
      title: "Project to Modelica Power Grid (.mo)",
      description: "Translates PSS/E transmission network into an executable Modelica model.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseRaw(text);
        return psseToModelica(parsed);
      },
    },
    {
      id: "export_psse_pscad",
      title: "Export PSCAD / EMT Netlist",
      description: "Projects PSS/E base case to a three-phase electromagnetic transient (EMT) netlist.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return psseToEmtNetlist(parsed);
      },
    },
    {
      id: "run_psspy_script",
      title: "Execute Python psspy Automation Script",
      description: "Executes a PSS/E Python psspy automation script against a virtual fileset.",
      category: "simulate",
      execute: async (
        ctx,
        params: {
          script?: string | undefined;
          documentText?: string | undefined;
          files?: Record<string, string | Uint8Array> | undefined;
        },
      ) => {
        const script = params?.script ?? params?.documentText ?? ctx?.documentText ?? "";
        const session = executePythonPsspyScript(script, params?.files ?? {});
        return {
          messages: session.getMessages(),
          lastPowerFlow: session.getLastPowerFlow(),
          lastTransient: session.getLastTransient(),
          virtualFiles: Array.from(session.virtualFiles.keys()),
        };
      },
    },
    {
      id: "export_sav_binary",
      title: "Export Binary .sav Case Snapshot",
      description: "Serializes the solved PSS/E power flow case into a binary .sav snapshot buffer.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return serializePsseSav(parsed);
      },
    },
    {
      id: "inspect_out_channels",
      title: "Inspect Binary .out Dynamic Channels",
      description: "Parses a binary PSS/E .out dynamic simulation file (native or v33/v34 Fortran unformatted).",
      category: "query",
      execute: async (_ctx, params: { binaryBuffer?: Uint8Array | undefined }) => {
        if (!params?.binaryBuffer) return null;
        return parsePsseOut(params.binaryBuffer);
      },
    },
    {
      id: "read_psse_out_window",
      title: "Read Windowed Slice from Binary .out Trajectory (O(1) Seek)",
      description:
        "Performs O(1) fixed-stride byte-offset seeking on a streaming PSSE_OUT file/Blob without loading the full trajectory into RAM.",
      category: "query",
      execute: async (
        _ctx,
        params: { binaryBuffer?: Uint8Array | undefined; startStep?: number | undefined; count?: number | undefined },
      ) => {
        if (!params?.binaryBuffer) return null;
        const buf = params.binaryBuffer;
        return readPsseOutWindow(
          {
            byteLength: buf.byteLength,
            read: (offset, length) => buf.subarray(offset, offset + length),
          },
          params.startStep ?? 0,
          params.count ?? 250,
        );
      },
    },
    {
      id: "calculate_gic_tpl007",
      title: "Calculate Geomagnetically Induced Currents (GIC) & NERC TPL-007 Compliance",
      description:
        "Solves quasi-DC earth network under geoelectric field (Ex, Ey) and evaluates transformer Mvar losses and thermal limits.",
      category: "simulate",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: { documentText?: string | undefined; eEastVPerKm?: number; eNorthVPerKm?: number },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return calculateGic(parsed, {
          eEastVPerKm: params?.eEastVPerKm ?? 1.0,
          eNorthVPerKm: params?.eNorthVPerKm ?? 0.0,
        });
      },
    },
    {
      id: "execute_idv_script",
      title: "Execute PSS/E .idv Macro Script",
      description: "Executes a legacy PSS/E .idv batch command file against the active case.",
      category: "simulate",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: { script?: string | undefined; documentText?: string | undefined; rawCase?: string | undefined },
      ) => {
        const script = params?.script ?? params?.documentText ?? ctx?.documentText ?? "";
        let initialCase = undefined;
        if (params?.rawCase) {
          initialCase = parseRaw(params.rawCase);
        }
        return executeIdv(script, undefined, { initialCase });
      },
    },
    {
      id: "audit_nerc_compliance",
      title: "Audit NERC Reliability Compliance (MOD-025/026/027 & TPL-001)",
      description:
        "Executes automated validation for generator capability, dynamic exciters/governors, and transmission planning.",
      category: "query",
      execute: async (
        ctx: { documentText?: string | undefined },
        params?: { documentText?: string | undefined; includeContingencies?: boolean | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return auditNercCompliance(parsed, {
          includeContingencies: params?.includeContingencies ?? true,
        });
      },
    },
  ],

  extras: () => [/[ \t\r\n]+/],

  polyglot: pssePolyglotConfig,

  rules: {
    SourceFile: ($) =>
      def({
        syntax: choice(
          seq($["FormatRaw"]!, $["RawFile"]!),
          seq($["FormatDyr"]!, $["DyrFile"]!),
          seq($["FormatSeq"]!, $["SeqFile"]!),
          seq($["FormatCon"]!, $["ConFile"]!),
          seq($["FormatIdv"]!, $["IdvFile"]!),
          repeat($["DataRecord"]!),
        ),
        symbol: () => ({
          kind: "Class",
          name: "PsseCase",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          lint__psseGridValidity: (db: QueryDB, self: SymbolEntry) => {
            const fileUri =
              (self as unknown as { file?: string; uri?: string }).file ??
              (self as unknown as { uri?: string }).uri ??
              "";
            const lowerUri = fileUri.toLowerCase();
            if (
              lowerUri.endsWith(".dyr") ||
              lowerUri.endsWith(".seq") ||
              lowerUri.endsWith(".con") ||
              lowerUri.endsWith(".mon") ||
              lowerUri.endsWith(".sub") ||
              lowerUri.endsWith(".idv")
            ) {
              return null;
            }
            const text = (
              db as unknown as {
                cstText?: (start?: number, end?: number, entry?: SymbolEntry) => string | null;
              }
            ).cstText?.(self.startOffset, self.endOffset, self);
            if (!text) return null;
            const parsed = parseRaw(text);
            const diags = lintPsse(parsed, { tier: "fast" });
            if (diags.length === 0) return null;
            return diags.map((d) => ({
              severity: d.severity,
              code: d.code,
              message: d.message,
              startOffset: d.startOffset,
              endOffset: d.endOffset,
            }));
          },
        },
      }),

    // Multi-format GLR entry points (dispatched via Parser.parseFormat(source, "raw" | "dyr" | "seq" | "con" | "idv"))
    RawFile: ($) => repeat(choice($["RawMetadataLine"]!, $["RawComment"]!, $["RawFieldToken"]!)),
    RawMetadataLine: ($) => $["BangComment"]!,
    RawComment: ($) => choice($["SlashTerminator"]!, $["DoubleSlashComment"]!),
    RawFieldToken: ($) => choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!, ",", $["SymbolPunct"]!),

    DyrFile: ($) => repeat(choice($["DyrRecord"]!, $["BangComment"]!, $["DoubleSlashComment"]!)),
    DyrRecord: ($) => seq(repeat1($["RawFieldToken"]!), $["SlashTerminator"]!),

    SeqFile: ($) => repeat(choice($["RawMetadataLine"]!, $["RawComment"]!, $["RawFieldToken"]!)),
    ConFile: ($) => repeat(choice($["ConComment"]!, $["ConToken"]!)),
    ConComment: ($) => choice($["SlashTerminator"]!, $["BangComment"]!, $["DoubleSlashComment"]!),
    ConToken: ($) => choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!, ",", $["SymbolPunct"]!),

    IdvFile: ($) => repeat(choice($["IdvComment"]!, $["IdvToken"]!)),
    IdvComment: ($) => choice($["SlashTerminator"]!, $["BangComment"]!, $["DoubleSlashComment"]!),
    IdvToken: ($) => choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!, ",", $["SymbolPunct"]!),

    FormatRaw: () => /\uE000raw\uE001/,
    FormatDyr: () => /\uE000dyr\uE001/,
    FormatSeq: () => /\uE000seq\uE001/,
    FormatCon: () => /\uE000con\uE001/,
    FormatIdv: () => /\uE000idv\uE001/,

    DataRecord: ($) =>
      choice(
        $["SlashTerminator"]!,
        $["BangComment"]!,
        $["DoubleSlashComment"]!,
        $["Number"]!,
        $["QuotedString"]!,
        $["Identifier"]!,
        ",",
        $["SymbolPunct"]!,
      ),

    SlashTerminator: () => /\/[^\r\n]*/,
    BangComment: () => /@![^\r\n]*/,
    DoubleSlashComment: () => /\/\/[^\r\n]*/,
    Number: () => /[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?/,
    QuotedString: () => /'(?:''|[^'])*'|"(?:""|[^"])*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_@!.-]*/,
    SymbolPunct: () => /[:;()[\]=+*<>~#%&$^|\\?-]+/,
  },
});

registerBuiltInPsseLibrarySync();

export default psseLanguage;
