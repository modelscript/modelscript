// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntheticSymbolSpec, WorkspaceIndexingHooks } from "@modelscript/dsl";
import { parseLas } from "./las-parser.js";

/**
 * Builds the package-like root `Class` symbol for a `.las` resource together with its virtual
 * `Component` symbols (`numRows`, `numCurves`, `nullValue`, and one vector per logged curve).
 */
function indexLasResource(
  uri: string,
  rootNode:
    | { text?: string; startOffset?: number; endOffset?: number; startIndex?: number; endIndex?: number }
    | null
    | undefined,
): SyntheticSymbolSpec | undefined {
  if (!uri.toLowerCase().endsWith(".las")) return undefined;

  const filename = uri.split(/[/\\]/).pop() || "";
  const basename = filename.replace(/\.las$/i, "");
  const normalizedName = basename.replace(/[^a-zA-Z0-9_]/g, "_") || "WellLog";

  const children: SyntheticSymbolSpec[] = [];
  const rootNodeText = typeof rootNode?.text === "string" ? rootNode.text : "";

  if (rootNodeText.trim().length > 0) {
    const doc = parseLas(rootNodeText);
    const numRows = doc.rows.length;
    const numCurves = doc.curves.length;

    const virtual = (
      name: string,
      typeSpecifier: string,
      lasValue: unknown,
      unit?: string,
      arrayDimensions?: number[],
    ): SyntheticSymbolSpec => ({
      kind: "Component",
      name,
      ruleName: "LASVirtualComponent",
      startOffset: 0,
      endOffset: 0,
      dirty: true,
      metadata: {
        typeSpecifier,
        lasValue,
        _className: "LASVirtualComponent",
        ...(unit ? { unit } : {}),
        ...(arrayDimensions ? { arrayDimensions } : {}),
      },
    });

    children.push(virtual("numRows", "Integer", numRows));
    children.push(virtual("numCurves", "Integer", numCurves));
    children.push(virtual("nullValue", "Real", doc.nullValue));

    for (let c = 0; c < doc.curves.length; c++) {
      const curve = doc.curves[c]!;
      const colName = curve.mnemonic.replace(/[^a-zA-Z0-9_]/g, "_") || `curve_${c + 1}`;
      children.push(
        virtual(
          colName,
          "Real",
          doc.rows.map((row) => row[c] ?? NaN),
          curve.unit || undefined,
          [numRows],
        ),
      );
    }
  }

  return {
    kind: "Class",
    name: normalizedName,
    ruleName: "SourceFile",
    startOffset: rootNode?.startOffset ?? rootNode?.startIndex ?? 0,
    endOffset: rootNode?.endOffset ?? rootNode?.endIndex ?? 0,
    metadata: { classPrefixes: "package" },
    children,
  };
}

/** Workspace indexing hooks for CWLS LAS well-log resources. */
export const lasWorkspaceHooks: WorkspaceIndexingHooks = {
  indexResource: indexLasResource,
};
