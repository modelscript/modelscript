// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";

export interface RpcRequestMessage<TParams = unknown> {
  id: string;
  type: "request";
  method: string;
  params: TParams;
}

export interface RpcResponseMessage<TResult = unknown> {
  id: string;
  type: "response";
  result?: TResult | undefined;
  error?: string | undefined;
}

export interface RpcNotificationMessage<TPayload = unknown> {
  type: "notification";
  event: string;
  payload: TPayload;
}

export type RpcWireMessage = RpcRequestMessage | RpcResponseMessage | RpcNotificationMessage;

/**
 * Type-safe RPC Bridge for VS Code Extension Host <-> Webview communications.
 * Provides Promise-correlated request/response handling, cancellation/timeout support,
 * and strongly typed event notifications.
 */
export class WebviewRpcBridge implements vscode.Disposable {
  private _pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private _requestHandlers = new Map<string, (params: any) => Promise<any> | any>();
  private _notificationHandlers = new Map<string, Set<(payload: any) => void>>();
  private _disposables: vscode.Disposable[] = [];
  private _nextRequestId = 1;

  constructor(private readonly _webview: vscode.Webview) {
    const sub = this._webview.onDidReceiveMessage((msg: unknown) => {
      this.handleIncomingMessage(msg);
    });
    this._disposables.push(sub);
  }

  public dispose(): void {
    for (const [id, req] of this._pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(`Webview RPC Bridge disposed before response for request #${id}.`));
    }
    this._pendingRequests.clear();
    this._requestHandlers.clear();
    this._notificationHandlers.clear();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  /**
   * Sends a request to the webview and awaits its response.
   */
  public async sendRequest<TResult = unknown, TParams = unknown>(
    method: string,
    params: TParams,
    timeoutMs = 15000,
  ): Promise<TResult> {
    const id = `req-${this._nextRequestId++}-${Date.now()}`;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`RPC Request '${method}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this._pendingRequests.set(id, { resolve, reject, timer });

      this._webview.postMessage({
        id,
        type: "request",
        method,
        params,
      } as RpcRequestMessage<TParams>);
    });
  }

  /**
   * Sends a one-way notification to the webview.
   */
  public sendNotification<TPayload = unknown>(event: string, payload: TPayload): void {
    this._webview.postMessage({
      type: "notification",
      event,
      payload,
    } as RpcNotificationMessage<TPayload>);
  }

  /**
   * Registers a handler for requests initiated by the webview.
   */
  public onRequest<TParams = unknown, TResult = unknown>(
    method: string,
    handler: (params: TParams) => Promise<TResult> | TResult,
  ): vscode.Disposable {
    this._requestHandlers.set(method, handler);
    return {
      dispose: () => {
        if (this._requestHandlers.get(method) === handler) {
          this._requestHandlers.delete(method);
        }
      },
    };
  }

  /**
   * Registers a handler for notifications emitted by the webview.
   */
  public onNotification<TPayload = unknown>(event: string, handler: (payload: TPayload) => void): vscode.Disposable {
    let handlers = this._notificationHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this._notificationHandlers.set(event, handlers);
    }
    handlers.add(handler);

    return {
      dispose: () => {
        handlers?.delete(handler);
        if (handlers && handlers.size === 0) {
          this._notificationHandlers.delete(event);
        }
      },
    };
  }

  private async handleIncomingMessage(rawMsg: unknown): Promise<void> {
    if (!rawMsg || typeof rawMsg !== "object") return;
    const msg = rawMsg as Record<string, any>;

    // Handle Response to our outgoing request
    if (msg.type === "response" && typeof msg.id === "string") {
      const pending = this._pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle Incoming Request from webview
    if (msg.type === "request" && typeof msg.method === "string" && typeof msg.id === "string") {
      const handler = this._requestHandlers.get(msg.method);
      if (!handler) {
        this._webview.postMessage({
          id: msg.id,
          type: "response",
          error: `Unhandled RPC method: '${msg.method}'`,
        } as RpcResponseMessage);
        return;
      }

      try {
        const result = await handler(msg.params);
        this._webview.postMessage({
          id: msg.id,
          type: "response",
          result,
        } as RpcResponseMessage);
      } catch (err: any) {
        this._webview.postMessage({
          id: msg.id,
          type: "response",
          error: err?.message || String(err),
        } as RpcResponseMessage);
      }
      return;
    }

    // Handle Incoming Notification from webview
    const eventName = msg.event || msg.type || msg.command;
    if (typeof eventName === "string") {
      const handlers = this._notificationHandlers.get(eventName);
      if (handlers) {
        const payload = msg.payload !== undefined ? msg.payload : msg.data !== undefined ? msg.data : msg;
        for (const handler of handlers) {
          try {
            handler(payload);
          } catch (e) {
            console.error(`Error in notification handler for '${eventName}':`, e);
          }
        }
      }
    }
  }
}
