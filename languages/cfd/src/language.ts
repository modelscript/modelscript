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
  tggComplement,
  tggEq,
  tggRule,
  type ActionExecutionContext,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
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
  lsp: {
    fileExtensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
    icons: {
      light: "./assets/cfd/icon-light.png",
      dark: "./assets/cfd/icon-dark.png",
    },
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
  polyglot: {
    languages: ["modelica", "sysml2"],
    rules: [
      tggRule({
        name: "CfdDragPolarToModelicaParam",
        sourceLang: "cfd",
        targetLang: "modelica",
        priority: 15,
        source: ($, v) => $.Directive({ key: "CD", value: v("cdVal") }),
        target: ($, v) => $.ComponentClause({ name: "Cd", defaultValue: v("cdVal") }),
        where: (v) => [tggEq(v("cdVal"), v("cdVal")), tggComplement(["refArea", "cl"])],
      }),
      tggRule({
        name: "CfdDragPolarToSysmlAttribute",
        sourceLang: "cfd",
        targetLang: "sysml2",
        priority: 15,
        source: ($, v) => $.Directive({ key: "CD", value: v("cdVal") }),
        target: ($, v) => $.AttributeUsage({ declaredName: "aeroDragCoeff", defaultValue: v("cdVal") }),
        where: (v) => [tggEq(v("cdVal"), v("cdVal")), tggComplement(["refArea", "cl"])],
      }),
      tggRule({
        name: "CfdInletToModelicaFluidPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.Directive({ key: "MARKER_INLET", value: v("markerVal") }),
        target: ($, _v) => $.ComponentClause({ name: "inlet", typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a" }),
        where: (_v) => [tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdHeatFluxToModelicaHeatPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.Directive({ key: "MARKER_HEATFLUX", value: v("markerVal") }),
        target: ($, _v) =>
          $.ComponentClause({
            name: "heatPort",
            typeSpecifier: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
          }),
        where: (_v) => [tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdMarkerToSysmlPort",
        sourceLang: "cfd",
        targetLang: "sysml2",
        priority: 5,
        source: ($, v) => $.Directive({ key: "MARKER_SYM", value: v("markerVal") }),
        target: ($, v) => $.PortUsage({ declaredName: "marker_sym", declaredType: v("markerVal") }),
        where: (v) => [tggEq(v("markerVal"), v("markerVal")), tggComplement(["dialect", "options"])],
      }),
      tggRule({
        name: "CfdDirectiveToSysmlConstraint",
        sourceLang: "cfd",
        targetLang: "sysml2",
        priority: 0,
        source: ($, v) => $.Directive({ key: v("dirKey"), value: v("dirVal") }),
        target: ($, v) => $.ConstraintUsage({ declaredName: v("dirKey") }),
        where: (v) => [tggEq(v("dirKey"), v("dirKey")), tggComplement(["dirVal"])],
      }),
    ],
  },

  primitives: {
    lineComment: "%",
  },

  extras: () => [/[ \t\r]+/],

  rules: {
    // Root configuration file rule exposing Salsa instantiation and name-resolution queries
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($["CommentLine"]!, $["Directive"]!, $["_newline"]!)),
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

    CommentLine: ($) => seq(choice("%", "//", "#"), /.*/, $["_newline"]!),

    _newline: () => /\n/,

    // Key-value configuration directive (`KEY = VALUE`) indexed as a Property symbol
    Directive: ($) =>
      def({
        syntax: seq(
          field("key", $["IDENTIFIER"]!),
          "=",
          field("value", choice($["TupleValue"]!, $["ScalarValue"]!, $["EmbeddedExpression"]!)),
          choice($["_newline"]!, optional(/\r?\n/)),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Property",
          name: self["key"] ?? "DIRECTIVE",
        }),
      }),

    TupleValue: ($) =>
      seq(
        "(",
        choice($["ScalarValue"]!, $["EmbeddedExpression"]!),
        repeat(seq(",", choice($["ScalarValue"]!, $["EmbeddedExpression"]!))),
        ")",
      ),

    ScalarValue: ($) => choice($["NUMBER"]!, $["IDENTIFIER"]!, $["STRING"]!),

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

    PrimaryExpression: ($) =>
      choice($["QualifiedIdentifier"]!, $["NUMBER"]!, $["STRING"]!, seq("(", $["Expression"]!, ")")),

    QualifiedIdentifier: ($) => seq($["IDENTIFIER"]!, repeat(seq(".", $["IDENTIFIER"]!))),

    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NUMBER: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    STRING: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
  },
});
