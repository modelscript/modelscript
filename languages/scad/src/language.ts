// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Solid } from "@modelscript/cad";
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
  tggDefaultVal,
  tggEq,
  tggRule,
} from "@modelscript/dsl";
import type { ScadCstNode } from "./patcher.js";
import { scadWriteback } from "./writeback.js";

interface ScadLspActionContext {
  languageId?: string | undefined;
  uri?: string | undefined;
  documentText?: string | undefined;
  documents?: { get(uri: string): { getText(): string } | undefined } | undefined;
  documentManager?:
    | {
        documents?:
          | {
              get(uri: string): { getText(): string } | undefined;
              all?(): { uri: string; getText(): string }[];
            }
          | undefined;
        documentTrees?:
          | Map<string, { text?: string | undefined; tree?: { rootNode?: ScadCstNode | undefined } | undefined }>
          | undefined;
      }
    | undefined;
  sharedFs?: { read(uri: string): Promise<string> } | undefined;
  parserService?:
    | {
        ensureLanguageParserLoaded?(lang: string): Promise<unknown>;
        getParser(
          lang: string,
        ): Promise<{ parse(source: string): { rootNode?: ScadCstNode | undefined } | null } | null>;
      }
    | undefined;
}

async function resolveScadSourceAndRoot(
  ctx: ScadLspActionContext,
  params?: { uri?: string | undefined; documentText?: string | undefined },
): Promise<{ uri: string | undefined; source: string | undefined; rootNode: ScadCstNode | undefined }> {
  const uri = params?.uri ?? ctx.uri;
  let source = params?.documentText ?? ctx.documentText;

  if (!source && uri && ctx.documents) {
    source = ctx.documents.get(uri)?.getText();
  }
  if (!source && uri && ctx.documentManager?.documents) {
    source = ctx.documentManager.documents.get(uri)?.getText();
    if (!source && typeof ctx.documentManager.documents.all === "function") {
      const targetName = uri.split("/").pop();
      for (const doc of ctx.documentManager.documents.all()) {
        if (doc.uri === uri || (targetName && doc.uri.endsWith(`/${targetName}`))) {
          source = doc.getText();
          if (source) break;
        }
      }
    }
  }
  if (!source && uri && ctx.documentManager?.documentTrees) {
    source = ctx.documentManager.documentTrees.get(uri)?.text;
    if (!source) {
      const targetName = uri.split("/").pop();
      for (const [k, entry] of ctx.documentManager.documentTrees) {
        if (k === uri || (targetName && k.endsWith(`/${targetName}`))) {
          source = entry.text;
          if (source) break;
        }
      }
    }
  }
  if (!source && uri && ctx.sharedFs) {
    try {
      source = await ctx.sharedFs.read(uri);
    } catch {}
  }

  let rootNode: ScadCstNode | undefined = uri
    ? ctx.documentManager?.documentTrees?.get(uri)?.tree?.rootNode
    : undefined;
  if (!rootNode && source && ctx.parserService) {
    try {
      await ctx.parserService.ensureLanguageParserLoaded?.("scad");
      const parser = await ctx.parserService.getParser("scad");
      if (parser) {
        const tree = parser.parse(source);
        rootNode = tree?.rootNode;
      }
    } catch {}
  }
  if (!rootNode && source) {
    try {
      const { getScadParser } = await import("./index.js");
      const parser = await getScadParser();
      const tree = parser.parse(source);
      rootNode = tree?.rootNode;
    } catch {}
  }

  return { uri, source, rootNode };
}

interface ScadLintSymbol {
  id: number | string;
  kind?: string | undefined;
  name?: string | undefined;
  parentId: number | string | null;
  resourceId?: string | number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  fieldRanges?: Record<string, { startOffset: number; endOffset: number }> | undefined;
}

interface ScadLintDb {
  childrenOf(parentId: number | string): ScadLintSymbol[];
  byName(name: string): ScadLintSymbol[];
}

/**
 * Operator precedence levels for OpenSCAD expressions (from lowest to highest binding strength).
 */
const PREC = {
  CONDITIONAL: 1,
  OR: 2,
  AND: 3,
  EQUALITY: 4,
  RELATIONAL: 5,
  ADDITIVE: 6,
  MULTIPLICATIVE: 7,
  POWER: 8,
  UNARY: 9,
  POSTFIX: 10,
  PRIMARY: 11,
} as const;

/**
 * OpenSCAD (`.scad`) language definition for ModelScript.
 *
 * Defines the GLR grammar (supporting both traditional OpenSCAD prefix transforms and
 * fluent method-chaining syntax), LSP custom request handlers, 3D CSG preview/STEP export actions,
 * bidirectional writeback, and polyglot TGG rules linking SCAD geometry to SysML v2, STEP, and Modelica.
 */
export const scadLanguage = language({
  name: "scad",
  fileExtensions: [".scad"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".scad"],
    icons: {
      light: "./assets/scad/icon-light.png",
      dark: "./assets/scad/icon-dark.png",
    },
    handlers: {
      // Custom LSP request to extract parametric CAD components and source ranges for the 3D viewport
      "modelscript/getCadComponents": async (
        ctx: ScadLspActionContext,
        params: { uri: string; documentText?: string | undefined },
      ) => {
        const { uri, source, rootNode } = await resolveScadSourceAndRoot(ctx, params);
        if (!source) return [];

        const { extractScadCadComponents } = await import("./index.js");
        return extractScadCadComponents(source, rootNode, uri);
      },
    },
  },

  // Bidirectional writeback handler for updating SCAD source dimensions and transforms from 3D gizmos
  writeback: scadWriteback,

  // IDE and AI agent actions for 3D CSG evaluation and ISO 10303 STEP export
  actions: [
    {
      id: "preview_csg",
      title: "Preview 3D CSG Model",
      description: "Evaluates constructive solid geometry boolean trees and renders 3D polygonal meshes.",
      category: "geometry",
      execute: async (
        ctx: ScadLspActionContext,
        params?: { documentText?: string | undefined; uri?: string | undefined },
      ) => {
        const { uri, source, rootNode } = await resolveScadSourceAndRoot(ctx, params);
        if (!source) {
          throw new Error("No OpenSCAD source code found to evaluate.");
        }

        // Evaluate the CST into a normalized CSG Solid tree
        let solid: Solid | null = null;
        if (rootNode) {
          const { ScadEvaluator } = await import("./evaluator.js");
          const evaluator = new ScadEvaluator();
          solid = evaluator.evaluate(rootNode);
        } else {
          const { compileScadToSolid } = await import("./index.js");
          solid = await compileScadToSolid(source);
        }

        if (!solid) {
          throw new Error("Failed to evaluate OpenSCAD CSG solid geometry.");
        }

        const { compileToStep } = await import("@modelscript/cad");
        const { extractScadCadComponents } = await import("./index.js");
        const step = compileToStep(solid);
        const components = await extractScadCadComponents(source, rootNode, uri);
        const filename = uri ? uri.split("/").pop() || "model" : "model";
        const name = filename.replace(/\.[^/.]+$/, "");

        return {
          success: true,
          name,
          step,
          solid,
          components,
          uri,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "scad_preview_csg",
          displayName: "Preview OpenSCAD CSG Model",
          modelDescription: "Evaluates CSG booleans and renders 3D geometry from OpenSCAD source.",
        },
      },
    },
    {
      id: "export_step",
      title: "Export Shape to STEP CAD (.step)",
      description: "Converts OpenSCAD boundary representations into standard ISO 10303 STEP solid bodies.",
      category: "export",
      execute: async (
        ctx: ScadLspActionContext,
        params?: { documentText?: string | undefined; uri?: string | undefined },
      ) => {
        const { rootNode, source } = await resolveScadSourceAndRoot(ctx, params);
        if (!source) {
          throw new Error("No OpenSCAD source code found to export.");
        }

        let solid: Solid | null = null;
        if (rootNode) {
          const { ScadEvaluator } = await import("./evaluator.js");
          const evaluator = new ScadEvaluator();
          solid = evaluator.evaluate(rootNode);
        } else {
          const { compileScadToSolid } = await import("./index.js");
          solid = await compileScadToSolid(source);
        }

        if (!solid) {
          throw new Error("Failed to compile OpenSCAD to solid geometry.");
        }

        const { compileToStep } = await import("@modelscript/cad");
        const step = compileToStep(solid);
        const filename = ctx.uri ? ctx.uri.split("/").pop() || "model" : "model";
        const name = filename.replace(/\.[^/.]+$/, "");

        return {
          step,
          name,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(export)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_convert@1",
        },
        languageModelTool: {
          name: "scad_export_step",
          displayName: "Export OpenSCAD to STEP CAD",
          modelDescription: "Converts OpenSCAD shapes into standard STEP CAD (.step) solid geometry.",
        },
      },
    },
  ],

  // Triple Graph Grammar (TGG) rules synchronizing OpenSCAD with SysML v2, STEP, and Modelica
  polyglot: {
    languages: ["sysml2", "step", "modelica"],
    rules: [
      tggRule({
        name: "ScadModuleToSysmlPart",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.ModuleDeclaration({ name: v("modName") }),
        target: ($, v) => $.PartDefinition({ declaredName: v("modName") }),
        where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["parameters", "body"])],
      }),
      tggRule({
        name: "ScadProjectedAreaToModelicaParam",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 15,
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) => $.ComponentClause({ name: "A", defaultValue: v("area") }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["area"])],
      }),
      tggRule({
        name: "ScadProjectedAreaToSysmlAttribute",
        sourceLang: "scad",
        targetLang: "sysml2",
        priority: 15,
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) => $.AttributeUsage({ declaredName: "totalFrontalArea", defaultValue: v("area") }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["area"])],
      }),
      tggRule({
        name: "ScadTagPortToSysmlPort",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) => $.PortUsage({ declaredName: v("portName") }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["transformStack"])],
      }),
      tggRule({
        name: "ScadVariableToSysmlAttribute",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.VariableDeclaration({ name: v("varName"), value: v("val") }),
        target: ($, v) => $.AttributeUsage({ declaredName: v("varName"), defaultValue: v("val") }),
        where: (v) => [tggEq(v("varName"), v("varName")), tggEq(v("val"), v("val"))],
      }),
      tggRule({
        name: "ScadSolidToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        source: ($, v) => $.CubePrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims") }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadCylinderToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        priority: 10,
        source: ($, v) => $.CylinderPrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims"), description: "CylinderSolid" }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadSphereToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        priority: 5,
        source: ($, v) => $.SpherePrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims"), description: "SphereSolid" }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadBooleanOpToStepComposite",
        sourceLang: "scad",
        targetLang: "step",
        priority: 15,
        source: ($, v) => $.BooleanOp({ op: v("opName"), body: v("children") }),
        target: ($, v) => $.ProductDefinition({ name: v("opName"), description: "CSGComposite" }),
        where: (v) => [tggEq(v("opName"), v("opName")), tggComplement(["children"])],
      }),
      tggRule({
        name: "ScadTagPortToModelicaFrame",
        sourceLang: "scad",
        targetLang: "modelica",
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("portName"), typeSpecifier: "Modelica.Mechanics.MultiBody.Interfaces.Frame_a" }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["transformStack"])],
      }),
      tggRule({
        name: "ScadCubeToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 5,
        source: ($, v) => $.CubePrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "boxVisualizer"), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadCylinderToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.CylinderPrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "cylinderVisualizer"), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadSphereToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 5,
        source: ($, v) => $.SpherePrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "sphereVisualizer"), tggComplement(["transforms", "color"])],
      }),
    ],
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  extras: () => [/\s+/],

  rules: {
    SourceFile: ($) => repeat($["Statement"]!),

    Statement: ($) =>
      choice(
        $["IncludeStatement"]!,
        $["UseStatement"]!,
        $["VariableDeclaration"]!,
        $["ModuleDeclaration"]!,
        $["FunctionDeclaration"]!,
        $["IfStatement"]!,
        $["ForStatement"]!,
        $["BlockStatement"]!,
        $["PrefixSolid"]!,
        $["ChainedSolidStatement"]!,
        $["_EmptyStatement"]!,
      ),

    IncludeStatement: ($) => $["INCLUDE_DIRECTIVE"]!,

    UseStatement: ($) => $["USE_DIRECTIVE"]!,

    _EmptyStatement: () => ";",

    BlockStatement: ($) => seq("{", repeat($["Statement"]!), "}"),

    // Variable assignment statement (`name = expr;`) with duplicate-assignment lint query
    VariableDeclaration: ($) =>
      def({
        syntax: seq(field("name", $["IDENTIFIER"]!), "=", field("value", $["Expression"]!), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Variable",
          name: self["name"] ?? "",
        }),
        queries: {
          lint__duplicateVariable: (db: ScadLintDb, self: ScadLintSymbol) => {
            if (!self.name || self.name.startsWith("$")) return null;
            const siblings =
              self.parentId !== null
                ? db.childrenOf(self.parentId)
                : db
                    .byName(self.name)
                    .filter((s: ScadLintSymbol) => s.parentId === null && s.resourceId === self.resourceId);
            const earlier = siblings.find(
              (s: ScadLintSymbol) =>
                s.id !== self.id &&
                s.kind === "Variable" &&
                s.name === self.name &&
                s.resourceId === self.resourceId &&
                (s.startOffset ?? 0) < (self.startOffset ?? 0),
            );
            if (!earlier) return null;
            const nameRange = self.fieldRanges?.["name"];
            return {
              severity: "warning" as const,
              code: "SCAD_DUPLICATE_DECLARATION",
              message: `Variable '${self.name}' is assigned multiple times in the same scope; the last assignment overrides earlier ones.`,
              field: "name",
              startOffset: nameRange?.startOffset ?? self.startOffset,
              endOffset: nameRange?.endOffset ?? (self.startOffset ?? 0) + self.name.length,
            };
          },
        },
      }),

    // Parametric module definition (`module name(params) body`)
    ModuleDeclaration: ($) =>
      def({
        syntax: seq(
          "module",
          field("name", $["IDENTIFIER"]!),
          "(",
          optional(field("parameters", $["ParameterList"]!)),
          ")",
          field("body", $["Statement"]!),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Module",
          name: self["name"] ?? "",
          exports: ["body"],
        }),
        queries: {
          lint__duplicateModule: (db: ScadLintDb, self: ScadLintSymbol) => {
            if (!self.name) return null;
            const siblings =
              self.parentId !== null
                ? db.childrenOf(self.parentId)
                : db
                    .byName(self.name)
                    .filter((s: ScadLintSymbol) => s.parentId === null && s.resourceId === self.resourceId);
            const earlier = siblings.find(
              (s: ScadLintSymbol) =>
                s.id !== self.id &&
                s.kind === "Module" &&
                s.name === self.name &&
                s.resourceId === self.resourceId &&
                (s.startOffset ?? 0) < (self.startOffset ?? 0),
            );
            if (!earlier) return null;
            const nameRange = self.fieldRanges?.["name"];
            return {
              severity: "error" as const,
              code: "SCAD_DUPLICATE_DECLARATION",
              message: `Duplicate module declaration '${self.name}' in the same scope.`,
              field: "name",
              startOffset: nameRange?.startOffset ?? self.startOffset,
              endOffset: nameRange?.endOffset ?? (self.startOffset ?? 0) + self.name.length,
            };
          },
        },
      }),

    // Pure mathematical function definition (`function name(params) = expr;`)
    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          "function",
          field("name", $["IDENTIFIER"]!),
          "(",
          optional(field("parameters", $["ParameterList"]!)),
          ")",
          "=",
          field("body", $["Expression"]!),
          ";",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self["name"] ?? "",
        }),
        queries: {
          lint__duplicateFunction: (db: ScadLintDb, self: ScadLintSymbol) => {
            if (!self.name) return null;
            const siblings =
              self.parentId !== null
                ? db.childrenOf(self.parentId)
                : db
                    .byName(self.name)
                    .filter((s: ScadLintSymbol) => s.parentId === null && s.resourceId === self.resourceId);
            const earlier = siblings.find(
              (s: ScadLintSymbol) =>
                s.id !== self.id &&
                s.kind === "Function" &&
                s.name === self.name &&
                s.resourceId === self.resourceId &&
                (s.startOffset ?? 0) < (self.startOffset ?? 0),
            );
            if (!earlier) return null;
            const nameRange = self.fieldRanges?.["name"];
            return {
              severity: "error" as const,
              code: "SCAD_DUPLICATE_DECLARATION",
              message: `Duplicate function declaration '${self.name}' in the same scope.`,
              field: "name",
              startOffset: nameRange?.startOffset ?? self.startOffset,
              endOffset: nameRange?.endOffset ?? (self.startOffset ?? 0) + self.name.length,
            };
          },
        },
      }),

    IfStatement: ($) =>
      choice(
        prec.right(
          1,
          seq(
            "if",
            "(",
            field("condition", $["Expression"]!),
            ")",
            field("consequence", $["Statement"]!),
            "else",
            field("alternative", $["Statement"]!),
          ),
        ),
        prec.right(0, seq("if", "(", field("condition", $["Expression"]!), ")", field("consequence", $["Statement"]!))),
      ),

    ForStatement: ($) =>
      seq(
        "for",
        "(",
        field("var", $["IDENTIFIER"]!),
        "=",
        field("range", $["Expression"]!),
        ")",
        field("body", $["Statement"]!),
      ),

    ParameterList: ($) => seq($["Parameter"]!, repeat(seq(",", $["Parameter"]!))),

    Parameter: ($) => seq(field("name", $["IDENTIFIER"]!), optional(seq("=", field("default", $["Expression"]!)))),

    ArgumentList: ($) => seq($["Argument"]!, repeat(seq(",", $["Argument"]!))),

    Argument: ($) =>
      choice(
        seq(field("name", $["IDENTIFIER"]!), "=", field("value", $["Expression"]!)),
        field("value", $["Expression"]!),
      ),

    // ── Solid Statements & Hybrid Chaining ─────────────────────────────────

    // Traditional OpenSCAD prefix operator syntax (`translate(...) rotate(...) cube(...);` or `my_mod(...) { ... }`)
    PrefixSolid: ($) =>
      choice(
        seq(
          field("operator", choice($["TransformOp"]!, $["BooleanOp"]!, $["TagPortOp"]!, $["LinearExtrudeOp"]!)),
          field("child", $["Statement"]!),
        ),
        seq(field("operator", $["ModuleInstantiation"]!), field("child", $["OperatorChildStatement"]!)),
      ),

    OperatorChildStatement: ($) =>
      choice(
        $["BlockStatement"]!,
        $["PrefixSolid"]!,
        $["ChainedSolidStatement"]!,
        $["ForStatement"]!,
        $["IfStatement"]!,
      ),

    TransformOp: ($) =>
      choice(
        seq("translate", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("rotate", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("scale", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("mirror", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("multmatrix", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("color", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("offset", "(", optional(field("args", $["ArgumentList"]!)), ")"),
      ),

    LinearExtrudeOp: ($) =>
      choice(
        seq("linear_extrude", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("rotate_extrude", "(", optional(field("args", $["ArgumentList"]!)), ")"),
      ),

    BooleanOp: ($) =>
      choice(
        seq("union", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("difference", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("intersection", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("hull", "(", optional(field("args", $["ArgumentList"]!)), ")"),
        seq("minkowski", "(", optional(field("args", $["ArgumentList"]!)), ")"),
      ),

    // ModelScript extension for tagging boundary patches/ports on 3D solids
    TagPortOp: ($) =>
      def({
        syntax: seq("tag_port", "(", field("args", $["ArgumentList"]!), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "TaggedPort",
          name: self["args"] ?? "",
        }),
      }),

    // Fluent method-chained solid syntax (`cube([10, 10, 10]).translate([0, 0, 5]).fillet(1);`)
    ChainedSolidStatement: ($) => seq(field("solid", $["ChainedSolid"]!), ";"),

    ChainedSolid: ($) => seq(field("receiver", $["PrimarySolid"]!), repeat(field("method", $["MethodCall"]!))),

    MethodCall: ($) => seq(".", field("name", $["MethodName"]!), "(", optional(field("args", $["ArgumentList"]!)), ")"),

    MethodName: ($) =>
      choice(
        $["IDENTIFIER"]!,
        "translate",
        "rotate",
        "scale",
        "mirror",
        "multmatrix",
        "color",
        "offset",
        "fillet",
        "chamfer",
      ),

    PrimarySolid: ($) =>
      choice(
        $["CubePrimitive"]!,
        $["CylinderPrimitive"]!,
        $["SpherePrimitive"]!,
        $["PolyhedronPrimitive"]!,
        $["PolygonPrimitive"]!,
        $["CirclePrimitive"]!,
        $["SquarePrimitive"]!,
        $["ModuleInstantiation"]!,
      ),

    CubePrimitive: ($) => seq("cube", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    CylinderPrimitive: ($) => seq("cylinder", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    SpherePrimitive: ($) => seq("sphere", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    PolyhedronPrimitive: ($) => seq("polyhedron", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    PolygonPrimitive: ($) => seq("polygon", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    CirclePrimitive: ($) => seq("circle", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    SquarePrimitive: ($) => seq("square", "(", optional(field("args", $["ArgumentList"]!)), ")"),

    ModuleInstantiation: ($) =>
      seq(field("name", $["IDENTIFIER"]!), "(", optional(field("args", $["ArgumentList"]!)), ")"),

    // ── Expressions ────────────────────────────────────────────────────────

    Expression: ($) =>
      choice(
        $["LetExpression"]!,
        $["ConditionalExpression"]!,
        $["BinaryExpression"]!,
        $["UnaryExpression"]!,
        $["PostfixExpression"]!,
        $["PrimaryExpression"]!,
      ),

    LetExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq("let", "(", optional(field("bindings", $["ArgumentList"]!)), ")", field("body", $["Expression"]!)),
      ),

    ListComprehension: ($) =>
      seq(
        "for",
        "(",
        field("var", $["IDENTIFIER"]!),
        "=",
        field("range", $["Expression"]!),
        ")",
        optional(seq("if", "(", field("condition", $["Expression"]!), ")")),
        field("body", $["Expression"]!),
      ),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("condition", $["Expression"]!),
          "?",
          field("consequence", $["Expression"]!),
          ":",
          field("alternative", $["Expression"]!),
        ),
      ),

    BinaryExpression: ($) =>
      choice(
        prec.left(
          PREC.OR,
          seq(field("left", $["Expression"]!), field("operator", "||"), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.AND,
          seq(field("left", $["Expression"]!), field("operator", "&&"), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.EQUALITY,
          seq(field("left", $["Expression"]!), field("operator", choice("==", "!=")), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.RELATIONAL,
          seq(
            field("left", $["Expression"]!),
            field("operator", choice("<", "<=", ">", ">=")),
            field("right", $["Expression"]!),
          ),
        ),
        prec.left(
          PREC.ADDITIVE,
          seq(field("left", $["Expression"]!), field("operator", choice("+", "-")), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.MULTIPLICATIVE,
          seq(
            field("left", $["Expression"]!),
            field("operator", choice("*", "/", "%")),
            field("right", $["Expression"]!),
          ),
        ),
        prec.right(
          PREC.POWER,
          seq(field("left", $["Expression"]!), field("operator", "^"), field("right", $["Expression"]!)),
        ),
      ),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("!", "-", "+")), field("operand", $["Expression"]!))),

    PostfixExpression: ($) =>
      choice(
        prec(PREC.POSTFIX, seq(field("operand", $["Expression"]!), "[", field("index", $["Expression"]!), "]")),
        prec(
          PREC.POSTFIX,
          seq(field("function", $["Expression"]!), "(", optional(field("arguments", $["ArgumentList"]!)), ")"),
        ),
      ),

    PrimaryExpression: ($) =>
      choice(
        $["NUMBER"]!,
        $["STRING"]!,
        $["BOOLEAN"]!,
        $["UNDEF"]!,
        $["IDENTIFIER"]!,
        $["VectorLiteral"]!,
        $["RangeLiteral"]!,
        $["ParenthesizedExpression"]!,
      ),

    ParenthesizedExpression: ($) => seq("(", field("expression", $["Expression"]!), ")"),

    VectorLiteral: ($) =>
      seq(
        "[",
        optional(
          seq(
            choice($["ListComprehension"]!, $["Expression"]!),
            repeat(seq(",", choice($["ListComprehension"]!, $["Expression"]!))),
          ),
        ),
        "]",
      ),

    RangeLiteral: ($) =>
      seq(
        "[",
        field("start", $["Expression"]!),
        ":",
        choice(
          seq(field("step", $["Expression"]!), ":", field("end", $["Expression"]!)),
          field("end", $["Expression"]!),
        ),
        "]",
      ),

    // ── Terminals ──────────────────────────────────────────────────────────

    INCLUDE_DIRECTIVE: () => /include[ \t]*<[^>\r\n]+>/,

    USE_DIRECTIVE: () => /use[ \t]*<[^>\r\n]+>/,

    IDENTIFIER: () => /\$?[a-zA-Z_][a-zA-Z0-9_]*/,

    NUMBER: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,

    STRING: () => /"([^"\\]|\\.)*"/,

    BOOLEAN: () => choice("true", "false"),

    UNDEF: () => "undef",
  },
});

export default scadLanguage;
