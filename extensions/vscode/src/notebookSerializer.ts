import * as vscode from "vscode";

/**
 * Raw cell format for .monb (Modelica Notebook) JSON files.
 */
interface RawNotebookCell {
  cell_type: "code" | "markdown";
  source: string[];
  outputs?: RawCellOutput[];
}

interface RawCellOutput {
  output_type: "text" | "json" | "error";
  text?: string;
  data?: unknown;
}

interface RawNotebook {
  cells: RawNotebookCell[];
}

/**
 * Serializer for .monb (Modelica Notebook) files.
 *
 * File format: JSON with structure `{ cells: [{ cell_type, source, outputs? }] }`.
 */
export class ModelicaNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(content: Uint8Array): Promise<vscode.NotebookData> {
    const text = new TextDecoder().decode(content);

    let raw: RawNotebookCell[];
    try {
      const parsed = JSON.parse(text) as RawNotebook;
      raw = parsed.cells ?? [];
    } catch {
      // Empty or invalid file — start with one empty code cell
      raw = [{ cell_type: "code", source: [] }];
    }

    const cells = raw.map((cell) => {
      const kind = cell.cell_type === "markdown" ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code;
      const language = cell.cell_type === "markdown" ? "markdown" : "modelica";
      const cellData = new vscode.NotebookCellData(kind, cell.source.join("\n"), language);

      // Restore persisted outputs
      if (cell.outputs?.length) {
        cellData.outputs = cell.outputs.map((out) => {
          if (out.output_type === "error") {
            return new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.error(new Error(out.text ?? "Unknown error")),
            ]);
          }
          if (out.output_type === "json" && out.data !== undefined) {
            return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.json(out.data, "application/json")]);
          }
          return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(out.text ?? "")]);
        });
      }

      return cellData;
    });

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(data: vscode.NotebookData): Promise<Uint8Array> {
    const cells: RawNotebookCell[] = data.cells.map((cell) => {
      const raw: RawNotebookCell = {
        cell_type: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
        source: cell.value.split(/\r?\n/),
      };

      // Persist outputs (optional — keeps notebook state across saves)
      if (cell.outputs?.length) {
        raw.outputs = cell.outputs.map((out) => {
          const first = out.items[0];
          if (!first) return { output_type: "text" as const, text: "" };

          if (first.mime === "application/vnd.code.notebook.error") {
            return { output_type: "error" as const, text: new TextDecoder().decode(first.data) };
          }
          if (first.mime === "application/json") {
            try {
              return {
                output_type: "json" as const,
                data: JSON.parse(new TextDecoder().decode(first.data)),
              };
            } catch {
              return { output_type: "text" as const, text: new TextDecoder().decode(first.data) };
            }
          }
          return { output_type: "text" as const, text: new TextDecoder().decode(first.data) };
        });
      }

      return raw;
    });

    const notebook: RawNotebook = { cells };
    return new TextEncoder().encode(JSON.stringify(notebook, null, 2) + "\n");
  }
}
