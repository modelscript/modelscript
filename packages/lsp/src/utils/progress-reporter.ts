// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsp — Background Work-Done Progress Streaming (`$/progress`).
 *
 * Implements standard LSP Work Done Progress reporting with cooperative token cancellation.
 * Allows heavy formal verification solvers (flowpipes, Nelson-Oppen fixpoints, BDF simulations)
 * to stream non-blocking progress to the IDE status bar without freezing keystroke editing.
 */

import type { Connection } from "vscode-languageserver";

export interface ProgressReporterOptions {
  cancellable?: boolean | undefined;
  message?: string | undefined;
  initialPercentage?: number | undefined;
}

export class LspWorkDoneProgressReporter {
  private static activeReporters = new Map<string, LspWorkDoneProgressReporter>();
  private static registeredConnections = new WeakSet<Connection>();

  public readonly token: string;
  public readonly abortController = new AbortController();
  public isCancelled = false;
  private isEnded = false;

  constructor(
    private readonly connection: Connection,
    token: string,
  ) {
    this.token = token;
    LspWorkDoneProgressReporter.activeReporters.set(token, this);
  }

  /**
   * Registers the `window/workDoneProgress/cancel` notification listener on the connection.
   */
  public static registerCancelHandler(connection: Connection): void {
    if (this.registeredConnections.has(connection)) return;
    this.registeredConnections.add(connection);

    connection.onNotification("window/workDoneProgress/cancel", (params: { token: string }) => {
      const reporter = this.activeReporters.get(params.token);
      if (reporter) {
        reporter.isCancelled = true;
        reporter.abortController.abort();
        connection.console.info?.(`[LspProgress] Verification progress cancelled by user for token: ${params.token}`);
      }
    });
  }

  /**
   * Requests the client to allocate a work done progress token and sends the initial `begin` payload.
   */
  public static async create(
    connection: Connection,
    title: string,
    options: ProgressReporterOptions = {},
  ): Promise<LspWorkDoneProgressReporter> {
    this.registerCancelHandler(connection);
    const token = `modelscript-verif-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const reporter = new LspWorkDoneProgressReporter(connection, token);

    try {
      // 1. Request client to create work done progress
      await connection.sendRequest("window/workDoneProgress/create", { token });
    } catch {
      // Best-effort: client might not support window/workDoneProgress/create
    }

    // 2. Send begin notification
    try {
      connection.sendNotification("$/progress", {
        token,
        value: {
          kind: "begin",
          title,
          cancellable: options.cancellable ?? true,
          message: options.message || "Starting formal verification...",
          percentage: options.initialPercentage ?? 0,
        },
      });
    } catch {}

    return reporter;
  }

  /**
   * Reports incremental progress percentage and status message.
   */
  public report(percentage?: number, message?: string): void {
    if (this.isEnded || this.isCancelled) return;
    try {
      const payload: any = { kind: "report" };
      if (typeof percentage === "number") payload.percentage = Math.min(100, Math.max(0, percentage));
      if (message) payload.message = message;
      this.connection.sendNotification("$/progress", {
        token: this.token,
        value: payload,
      });
    } catch {}
  }

  /**
   * Concludes the progress session and cleans up active references.
   */
  public done(message?: string): void {
    if (this.isEnded) return;
    this.isEnded = true;
    LspWorkDoneProgressReporter.activeReporters.delete(this.token);

    try {
      this.connection.sendNotification("$/progress", {
        token: this.token,
        value: {
          kind: "end",
          message: message || "Verification complete",
        },
      });
    } catch {}
  }
}
