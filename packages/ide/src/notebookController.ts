import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/** Notebook type must match the one registered in package.json contributes.notebooks */
const NOTEBOOK_TYPE = "modelscript-notebook";

/**
 * Notebook controller (kernel) for Modelica scripts.
 *
 * Each notebook gets a unique session ID so that variables defined in one cell
 * persist into subsequent cells (shared ModelicaScriptScope on the server).
 */
export class ModelicaNotebookController implements vscode.Disposable {
  static readonly controllerId = "modelscript-notebook-kernel";
  static readonly label = "Modelica";

  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private _client: LanguageClient | undefined;

  /** Map notebook URI → session ID for shared scope. */
  private _sessions = new Map<string, string>();

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      ModelicaNotebookController.controllerId,
      NOTEBOOK_TYPE,
      ModelicaNotebookController.label,
    );

    this._controller.supportedLanguages = ["modelica"];
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._execute.bind(this);
  }

  /** Set (or update) the language client used for execution. */
  set client(c: LanguageClient | undefined) {
    this._client = c;
  }

  /** Get or create a session ID for a notebook. */
  private _getSessionId(notebook: vscode.NotebookDocument): string {
    const key = notebook.uri.toString();
    let id = this._sessions.get(key);
    if (!id) {
      id = `nb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this._sessions.set(key, id);
    }
    return id;
  }

  /** Reset the kernel session for a notebook (clears shared scope). */
  async resetSession(notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    const sessionId = this._sessions.get(key);
    if (sessionId && this._client) {
      try {
        await this._client.sendRequest("modelscript/resetNotebookSession", { sessionId });
      } catch {
        // ignore — session may not exist on server yet
      }
    }
    // Generate a new session ID so subsequent cells start fresh
    this._sessions.delete(key);
    this._executionOrder = 0;
  }

  private _execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument): void {
    for (const cell of cells) {
      this._doExecution(cell, notebook);
    }
  }

  private async _doExecution(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    if (!this._client) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(new Error("Language server not ready. Please wait for initialization.")),
        ]),
      ]);
      execution.end(false, Date.now());
      return;
    }

    const sessionId = this._getSessionId(notebook);
    const code = cell.document.getText();

    try {
      const result = await this._client.sendRequest<{
        output: string;
        error?: string;
        diagrams?: { name: string; data: unknown }[];
      }>("modelscript/runNotebookCell", {
        sessionId,
        code,
      });

      const outputs: vscode.NotebookCellOutput[] = [];

      if (result.diagrams && result.diagrams.length > 0) {
        for (const diagram of result.diagrams) {
          outputs.push(
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.json(diagram.data, "application/x.modelscript-diagram"),
            ]),
          );
        }
      }

      if (result.error) {
        outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(result.error))]));
      }

      if (result.output) {
        // Try to parse as JSON for rich rendering
        try {
          const parsed = JSON.parse(result.output);
          outputs.push(
            new vscode.NotebookCellOutput([
              vscode.NotebookCellOutputItem.json(parsed, "application/json"),
              vscode.NotebookCellOutputItem.text(result.output),
            ]),
          );
        } catch {
          // Plain text output
          outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(result.output)]));
        }
      }

      if (outputs.length === 0) {
        // No output — still mark as successful
        execution.replaceOutput([]);
      } else {
        execution.replaceOutput(outputs);
      }

      execution.end(!result.error, Date.now());
    } catch (e) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(e instanceof Error ? e : new Error(String(e))),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }

  dispose(): void {
    this._controller.dispose();
  }
}
