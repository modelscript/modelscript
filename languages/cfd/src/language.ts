// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  prec,
  repeat,
  seq,
  type ActionExecutionContext,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { canIndexCfd, indexCfdDocument } from "./indexing.js";
import { cfdPolyglotConfig } from "./tgg/index.js";
import type { MaterializeOptions } from "./types.js";

interface CfdActionContext extends ActionExecutionContext {
  documents?: { get(uri: string): { getText(): string } | undefined } | undefined;
  sharedFs?: { read(uri: string): Promise<string> } | undefined;
}

/**
 * Operator precedence levels for embedded parameter expressions in CFD templates (`.cfgt`).
 */
const PREC = {
  ASSIGNMENT: 1,
  CONDITIONAL: 2,
  ADDITIVE: 3,
  MULTIPLICATIVE: 4,
  EXPONENTIATION: 5,
  UNARY: 6,
  PRIMARY: 7,
} as const;

/**
 * Computational Fluid Dynamics (`.cfd`, `.cfg`, `.cfgt`, `.su2`, `.foam`) language definition.
 *
 * Provides GLR grammar rules for SU2/OpenFOAM configuration decks and `{{ expr }}` template bindings,
 * 3D aerodynamics viewer/materialization/simulation actions, and polyglot TGG rules linking CFD
 * boundary markers and drag polars to Modelica fluid/thermal ports and SysML v2 attributes.
 */
export const cfdLanguage = language({
  name: "cfd",
  fileExtensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
  maturity: "beta",
  indexing: {
    indexFile: indexCfdDocument,
    canIndex: canIndexCfd,
  },
  lsp: {
    fileExtensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
    icons: {
      light: "./assets/cfd/icon-light.png",
      dark: "./assets/cfd/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "cfgEditor",
        viewType: "modelscript.cfgEditor",
        title: "CFD Config & Aerodynamics Studio",
        shortTitle: "CFD",
        selector: ["*.cfd", "*.cfg", "*.cfgt", "*.su2", "*.foam"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/CfdPanel.tsx",
        artifactViewTypes: ["cfd", "su2", "cfg"],
      },
    ],
    stencils: [
      { label: "Farfield", snippet: "MARKER_FAR= ( farfield )\n" },
      { label: "Euler Wall", snippet: "MARKER_EULER= ( wall_surface )\n" },
      { label: "Pressure Outlet", snippet: "MARKER_OUTLET= ( outlet, 101325.0 )\n" },
    ],
    toolbarButtons: [
      {
        id: "openCfdViewer",
        label: "Open 3D Aerodynamics Viewer",
        shortLabel: "Open 3D",
        tooltip: "Open 3D Aerodynamics Viewer",
        icon: "open-preview",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "open_cfd_viewer",
      },
      {
        id: "materializeConfig",
        label: "Materialize CFD Config (.cfgt -> .cfg)",
        shortLabel: "Materialize CFD",
        tooltip: "Materialize CFD Config (.cfgt -> .cfg)",
        icon: "file-code",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "materialize_config",
      },
      {
        id: "runSimulation",
        label: "Run CFD Aerodynamic Simulation",
        shortLabel: "Run CFD",
        tooltip: "Run CFD Aerodynamic Simulation",
        icon: "play",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "run_simulation",
      },
    ],
  },

  // IDE and AI agent actions for 3D aerodynamics viewing, template materialization, and CFD evaluation
  actions: [
    {
      id: "open_cfd_viewer",
      title: "Open 3D Aerodynamics Viewer",
      description: "Opens the 3D surface mesh and boundary marker viewer for SU2 aerodynamic configurations.",
      category: "query",
      execute: async (
        ctx: CfdActionContext,
        params: { documentText?: string | undefined; uri?: string | undefined },
      ) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No CFD configuration found to view.");
        }
        const { getCfdDialect } = await import("./dialects/index.js");
        const dialect = getCfdDialect(ctx.uri || "cfg");
        const modelData = dialect.parse(source);
        const { extractCfdSlicingProperties } = await import("./materializer.js");
        const slicing = extractCfdSlicingProperties(source);
        return {
          success: true,
          uri: ctx.uri,
          markers: Array.from(modelData.markers.keys()),
          meshFilename: modelData.meshFilename,
          slicing,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_cae@0",
        },
        languageModelTool: {
          name: "cfd_open_viewer",
          displayName: "Open 3D CFD Aerodynamics Viewer",
          modelDescription: "Renders 3D aerodynamic surface meshes, boundary markers, and pressure field probes.",
        },
      },
    },
    {
      id: "materialize_config",
      title: "Materialize CFD Config (.cfgt -> .cfg)",
      description: "Evaluates embedded parameter expressions to generate a concrete SU2 configuration file.",
      category: "transform",
      execute: async (
        ctx: CfdActionContext,
        params: {
          documentText?: string | undefined;
          uri?: string | undefined;
          options?: MaterializeOptions | undefined;
        },
      ) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No CFD config template found to materialize.");
        }
        const { materializeCfdConfig } = await import("./materializer.js");
        const materialized = materializeCfdConfig(source, params?.options);
        return {
          success: true,
          uri: ctx.uri,
          materialized,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(file-code)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@1",
        },
        languageModelTool: {
          name: "cfd_materialize_config",
          displayName: "Materialize SU2 CFD Config",
          modelDescription:
            "Evaluates template parameter expressions in a CFD config template (.cfgt) to generate a concrete .cfg file.",
        },
      },
    },
    {
      id: "run_simulation",
      title: "Run CFD Aerodynamic Simulation",
      description: "Executes an aerodynamic CFD evaluation on the active SU2/OpenFOAM configuration.",
      category: "simulate",
      execute: async (
        ctx: CfdActionContext,
        params: { documentText?: string | undefined; uri?: string | undefined },
      ) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No CFD configuration found to simulate.");
        }
        const { extractCfdSlicingProperties } = await import("./materializer.js");
        const slicing = extractCfdSlicingProperties(source);
        if (ctx.notifyProgress) {
          ctx.notifyProgress(
            `CFD Analysis: V=${slicing.freeStreamVelocity}m/s, Cd=${slicing.cd}, Cl=${slicing.cl ?? 0}, Fd=${slicing.dragForce ?? 0}N`,
          );
        }
        return {
          success: true,
          uri: ctx.uri,
          solver: "Aerodynamic Compressible/Incompressible CFD Evaluator",
          cd: slicing.cd,
          cl: slicing.cl ?? 0,
          refArea: slicing.refArea,
          density: slicing.density,
          freeStreamVelocity: slicing.freeStreamVelocity,
          machNumber: slicing.machNumber ?? 0,
          reynoldsNumber: slicing.reynoldsNumber ?? 0,
          aoaDeg: slicing.aoaDeg ?? 0,
          dragForce: slicing.dragForce ?? 0,
          liftForce: slicing.liftForce ?? 0,
          summary: `CFD simulation completed: V_inf = ${slicing.freeStreamVelocity} m/s (Re = ${slicing.reynoldsNumber ?? 0}, Mach = ${slicing.machNumber ?? 0}), Cd = ${slicing.cd}, Cl = ${slicing.cl ?? 0}, Drag = ${slicing.dragForce ?? 0} N, Lift = ${slicing.liftForce ?? 0} N`,
        };
      },
      ui: {
        editorContextMenu: {
          group: "1_run@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@2",
        },
        languageModelTool: {
          name: "cfd_run_simulation",
          displayName: "Run CFD Aerodynamic Simulation",
          modelDescription: "Executes aerodynamic CFD evaluation on the active SU2 or OpenFOAM configuration.",
        },
      },
    },
  ],

  // Triple Graph Grammar (TGG) rules linking CFD directives and markers to Modelica and SysML v2
  polyglot: cfdPolyglotConfig,

  primitives: {
    lineComment: "%",
  },

  extras: () => [/[ \t\r\n]+/, /(?:%|\/\/|#)[^\r\n]*/, /\/\*([^*]|\*+[^*/])*\*+\//],

  rules: {
    // Root configuration file rule exposing Salsa instantiation and name-resolution queries
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($["Directive"]!, $["NUMBER"]!)),
        symbol: () => ({
          kind: "Class",
          name: "CfdConfig",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const children = db.childrenOf(self.id);
            const byNameMap = new Map<string, SymbolEntry>();
            for (const child of children) {
              byNameMap.set(child.name, child);
            }
            return (name: string) => byNameMap.get(name) ?? null;
          },
        },
      }),

    // Key-value configuration directive (`KEY = VALUE` or OpenFOAM dictionary entry/block)
    Directive: ($) =>
      def({
        syntax: seq(
          field("key", choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!, $["STRING"]!)),
          choice(
            seq("=", field("value", $["DirectiveValue"]!)),
            seq("{", repeat($["Directive"]!), "}", optional(";")),
            seq(optional(field("value", $["FoamValue"]!)), ";"),
          ),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Property",
          name: self["key"] ?? "DIRECTIVE",
        }),
      }),

    DirectiveValue: ($) => choice($["TupleValue"]!, seq($["ScalarOrExpr"]!, repeat(seq(",", $["ScalarOrExpr"]!)))),

    TupleValue: ($) => seq("(", optional(seq($["ScalarOrExpr"]!, repeat(seq(",", $["ScalarOrExpr"]!)))), ")"),

    ScalarOrExpr: ($) => choice($["ScalarValue"]!, $["EmbeddedExpression"]!),

    ScalarValue: ($) =>
      choice(
        $["NUMBER"]!,
        $["STRING"]!,
        seq(
          choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!),
          repeat(
            choice(
              seq("/", choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!, $["NUMBER"]!)),
              seq("-", choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!)),
              seq("[", choice($["NUMBER"]!, $["IDENTIFIER"]!), "]"),
            ),
          ),
        ),
      ),

    FoamValue: ($) => seq($["FoamAtom"]!, repeat($["FoamAtom"]!)),

    FoamAtom: ($) =>
      choice(
        $["NUMBER"]!,
        $["STRING"]!,
        $["QUALIFIED_IDENT"]!,
        $["IDENTIFIER"]!,
        $["EmbeddedExpression"]!,
        $["FoamParenList"]!,
        $["FoamBracketList"]!,
      ),

    FoamParenList: ($) => seq("(", repeat(choice($["FoamAtom"]!, ",")), ")"),
    FoamBracketList: ($) => seq("[", repeat(choice($["FoamAtom"]!, ",")), "]"),

    // Embedded template expression (`{{ expr }}`) for parametric CFD materialization
    EmbeddedExpression: ($) =>
      def({
        syntax: seq("{{", field("expr", $["Expression"]!), "}}"),
        symbol: (self: Record<string, string>) => ({
          kind: "ExpressionBinding",
          name: self["expr"] ?? "",
        }),
      }),

    Expression: ($) => choice($["BinaryExpression"]!, $["UnaryExpression"]!, $["PrimaryExpression"]!),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.ADDITIVE, seq($["Expression"]!, choice("+", "-"), $["Expression"]!)),
        prec.left(PREC.MULTIPLICATIVE, seq($["Expression"]!, choice("*", "/"), $["Expression"]!)),
        prec.right(PREC.EXPONENTIATION, seq($["Expression"]!, "^", $["Expression"]!)),
      ),

    UnaryExpression: ($) => prec(PREC.UNARY, seq(choice("+", "-"), $["Expression"]!)),

    CallExpression: ($) =>
      seq(
        field("callee", $["QualifiedIdentifier"]!),
        "(",
        optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))),
        ")",
      ),

    PrimaryExpression: ($) =>
      choice(
        $["CallExpression"]!,
        $["QualifiedIdentifier"]!,
        $["NUMBER"]!,
        $["STRING"]!,
        seq("(", $["Expression"]!, ")"),
      ),

    QualifiedIdentifier: ($) => choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!),

    QUALIFIED_IDENT: () => /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/,
    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NUMBER: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    STRING: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
  },
});
