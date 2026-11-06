// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — Language Server Protocol (LSP) Services Integration.
 */

import { lintUsdStage } from "./lints/index.js";
import { parseUsd } from "./parser/index.js";
import type { UsdPrim } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code?: string | number | undefined;
  source?: string | undefined;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

const SCHEMA_DOCS: Record<string, string> = {
  PhysicsRigidBodyAPI:
    "**UsdPhysics.PhysicsRigidBodyAPI**\n\nApplies rigid-body simulation dynamics to a prim, enabling acceleration, mass tensor, and kinematic joint constraints in physics engines.",
  PhysicsMassAPI:
    "**UsdPhysics.PhysicsMassAPI**\n\nDefines explicit mass tensor properties: scalar mass (`physics:mass`), center of mass (`physics:centerOfMass`), and principal inertia (`physics:diagonalInertia`).",
  PhysicsCollisionAPI:
    "**UsdPhysics.PhysicsCollisionAPI**\n\nFlags geometry or primitive shapes as collision representation boundaries with contact filtering.",
  PhysicsRevoluteJoint:
    "**UsdPhysics.PhysicsRevoluteJoint**\n\nA single rotational degree of freedom joint between `physics:body0` and `physics:body1` along `physics:axis` ('X', 'Y', 'Z') with angular limits.",
  PhysicsPrismaticJoint:
    "**UsdPhysics.PhysicsPrismaticJoint**\n\nA single translational degree of freedom joint between two bodies along an axis with linear displacement limits.",
  PhysicsFixedJoint:
    "**UsdPhysics.PhysicsFixedJoint**\n\nA rigid 0-DOF constraint locking the relative 6D pose of two physics bodies.",
  Mesh: "**UsdGeom.Mesh**\n\nA polygonal boundary surface representation defined by `point3f[] points`, `int[] faceVertexIndices`, and `int[] faceVertexCounts`.",
  Xform:
    "**UsdGeom.Xform**\n\nA 3D affine coordinate frame defining local transformations via `xformOp:translate`, `xformOp:orient`, or `xformOp:transform`.",
};

export class UsdLspService {
  /** Validates an OpenUSD document and returns language server diagnostics. */
  public validate(content: string): LspDiagnostic[] {
    const stage = parseUsd(content);
    const diags = lintUsdStage(stage);

    return diags.map((d) => {
      const line0 = Math.max(0, d.range.startLine - 1);
      const col0 = Math.max(0, d.range.startColumn - 1);
      const endLine0 = Math.max(0, d.range.endLine - 1);
      const endCol0 = Math.max(0, d.range.endColumn - 1);

      return {
        range: {
          start: { line: line0, character: col0 },
          end: { line: endLine0, character: endCol0 },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code,
        source: "modelscript-usd",
        message: d.message,
      };
    });
  }

  /** Extracts document symbol hierarchy for outline view. */
  public getDocumentSymbols(content: string): LspDocumentSymbol[] {
    const stage = parseUsd(content);

    function buildPrimSymbol(prim: UsdPrim): LspDocumentSymbol {
      const line0 = Math.max(0, (prim.range?.startLine ?? 1) - 1);
      const col0 = Math.max(0, (prim.range?.startColumn ?? 1) - 1);
      const endLine0 = Math.max(0, (prim.range?.endLine ?? 1) - 1);
      const endCol0 = Math.max(0, (prim.range?.endColumn ?? 1) - 1);

      const r: LspRange = {
        start: { line: line0, character: col0 },
        end: { line: endLine0, character: endCol0 },
      };

      const children: LspDocumentSymbol[] = [];
      for (const child of prim.children.values()) {
        children.push(buildPrimSymbol(child));
      }

      // Attributes as fields
      for (const attr of prim.attributes.values()) {
        const aLine = Math.max(0, (attr.range?.startLine ?? 1) - 1);
        const aCol = Math.max(0, (attr.range?.startColumn ?? 1) - 1);
        children.push({
          name: attr.name,
          detail: attr.type,
          kind: LspSymbolKind.Field,
          range: { start: { line: aLine, character: aCol }, end: { line: aLine, character: aCol + attr.name.length } },
          selectionRange: {
            start: { line: aLine, character: aCol },
            end: { line: aLine, character: aCol + attr.name.length },
          },
        });
      }

      let kind = LspSymbolKind.Object;
      if (prim.typeName === "Mesh" || prim.typeName === "Cube" || prim.typeName === "Cylinder")
        kind = LspSymbolKind.Struct;
      else if (prim.typeName.includes("Joint")) kind = LspSymbolKind.Operator;
      else if (prim.typeName === "Xform") kind = LspSymbolKind.Namespace;

      return {
        name: prim.name,
        detail: `${prim.typeName}${prim.apiSchemas.length > 0 ? ` (${prim.apiSchemas.join(", ")})` : ""}`,
        kind,
        range: r,
        selectionRange: r,
        children: children.length > 0 ? children : undefined,
      };
    }

    return stage.rootPrims.map(buildPrimSymbol);
  }

  /** Provides hover documentation for OpenUSD schemas and prim properties. */
  public getHover(content: string, position: LspPosition): LspHover | null {
    const lines = content.split("\n");
    const lineText = lines[position.line] ?? "";

    // Search for schema keywords in current line
    for (const [key, doc] of Object.entries(SCHEMA_DOCS)) {
      if (lineText.includes(key)) {
        return {
          contents: {
            kind: "markdown",
            value: doc,
          },
        };
      }
    }

    if (lineText.includes("xformOp:translate") || lineText.includes("xformOp:orient")) {
      return {
        contents: {
          kind: "markdown",
          value:
            "**UsdGeom.XformOp**\n\nComponent affine transformation operation. Can be authored as static values or `.timeSamples` curves.",
        },
      };
    }

    return null;
  }
}
