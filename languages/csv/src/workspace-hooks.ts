// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntheticSymbolSpec, WorkspaceIndexingHooks } from "@modelscript/dsl";

/**
 * Builds the package-like root `Class` symbol for a `.csv` resource together with its virtual
 * `Component` symbols (`numRows`, `numCols`, `values`, and one array per column).
 */
function indexCsvResource(
  uri: string,
  rootNode:
    | { text?: string; startOffset?: number; endOffset?: number; startIndex?: number; endIndex?: number }
    | null
    | undefined,
): SyntheticSymbolSpec | undefined {
  if (!uri.endsWith(".csv")) return undefined;

  const filename = uri.split(/[/\\]/).pop() || "";
  const basename = filename.replace(/\.csv$/i, "");
  const normalizedName = basename.replace(/[^a-zA-Z0-9_]/g, "_");

  const children: SyntheticSymbolSpec[] = [];
  const rootNodeText = typeof rootNode?.text === "string" ? rootNode.text : "";
  const lines = rootNodeText.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
  if (lines.length > 0) {
    const headerLine = lines[0] as string;
    const delimiter = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
    const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/[^a-zA-Z0-9_]/g, "_"));
    const numCols = headers.length;

    const data: number[][] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = (lines[i] as string).split(delimiter);
      const row = parts.map((p) => parseFloat(p.trim()));
      if (row.length === numCols && !row.some(isNaN)) {
        data.push(row);
      }
    }
    const numRows = data.length;

    // Values are content-derived: report them changed whenever the file is re-indexed.
    const virtual = (
      name: string,
      typeSpecifier: string,
      csvValue: unknown,
      arrayDimensions?: number[],
    ): SyntheticSymbolSpec => ({
      kind: "Component",
      name,
      ruleName: "CSVVirtualComponent",
      startOffset: 0,
      endOffset: 0,
      dirty: true,
      metadata: {
        typeSpecifier,
        csvValue,
        _className: "CSVVirtualComponent",
        ...(arrayDimensions ? { arrayDimensions } : {}),
      },
    });

    children.push(virtual("numRows", "Integer", numRows));
    children.push(virtual("numCols", "Integer", numCols));
    children.push(virtual("values", "Real", data, [numRows, numCols]));
    for (let c = 0; c < numCols; c++) {
      const colName = headers[c] || `col${c}`;
      children.push(
        virtual(
          colName,
          "Real",
          data.map((row) => row[c]),
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

/** Workspace indexing conventions for tabular CSV resources. */
export const csvWorkspaceHooks: WorkspaceIndexingHooks = {
  indexResource: indexCsvResource,
};
