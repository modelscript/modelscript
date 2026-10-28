// SPDX-License-Identifier: AGPL-3.0-or-later

import { compressEmbedPayload, getLaunchUrl } from "./codec.js";
import type {
  EmbedDialect,
  EmbedToHostMessage,
  EmbedViewMode,
  HostToEmbedMessage,
  ModelElementAnchor,
  UniversalEmbedPayload,
  ZoomInterceptionMode,
} from "./protocol.js";

export interface EmbedOptions {
  /** Target HTML container or CSS selector */
  container: HTMLElement | string;
  /** Language dialect */
  dialect: EmbedDialect;
  /** Initial source code */
  code: string;
  /** Presentation mode */
  view?: EmbedViewMode;
  /** Model element anchor to highlight */
  anchor?: ModelElementAnchor;
  /** Embed server base URL */
  embedOrigin?: string;
  /** Theme preference */
  theme?: "dark" | "light";
  /** Library dependencies */
  dependencies?: Record<string, string>;
  /** Whether artifact is multi-file (routes to IDE instead of Playground) */
  isMultiFile?: boolean;
  artifactId?: string | number;
  /** Server-side stored morsel short ID for large models */
  morselId?: string;
  /** Signed embed token for private intranet artifacts */
  embedToken?: string;
  /** Wheel / scroll zoom interception policy */
  zoomMode?: ZoomInterceptionMode;
}

export type EmbedEventHandler<T = unknown> = (data: T) => void;

/**
 * High-level programmatic controller for embedded ModelScript artifact viewers.
 */
export class ModelScriptEmbed {
  private iframe: HTMLIFrameElement;
  private containerEl: HTMLElement;
  private options: EmbedOptions;
  private listeners: Map<string, Set<EmbedEventHandler<unknown>>> = new Map();
  private messageHandler: (e: MessageEvent) => void;
  private isReady = false;
  private pendingMessages: HostToEmbedMessage[] = [];
  private targetOrigin: string;

  constructor(options: EmbedOptions) {
    this.options = options;
    if (typeof options.container === "string") {
      const el = document.querySelector<HTMLElement>(options.container);
      if (!el) throw new Error(`Container '${options.container}' not found`);
      this.containerEl = el;
    } else {
      this.containerEl = options.container;
    }

    const payload: UniversalEmbedPayload = {
      v: 1,
      lang: options.dialect,
      code: options.code,
      view: options.view ?? "diagram",
      ...(options.anchor ? { anchor: options.anchor } : {}),
      ...(options.zoomMode ? { zoomMode: options.zoomMode } : {}),
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      ...(options.isMultiFile !== undefined ? { isMultiFile: options.isMultiFile } : {}),
      ...(options.artifactId ? { artifactId: options.artifactId } : {}),
      ...(options.morselId ? { morselId: options.morselId } : {}),
      ...(options.embedToken ? { embedToken: options.embedToken } : {}),
    };

    const rawOrigin = options.embedOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
    const origin = rawOrigin.replace(/\/+$/, "");
    try {
      this.targetOrigin = origin ? new URL(origin).origin : "*";
    } catch {
      this.targetOrigin = "*";
    }

    const queryParams = new URLSearchParams();
    if (options.morselId) queryParams.set("morsel", options.morselId);
    if (options.artifactId) queryParams.set("fromArtifact", String(options.artifactId));
    if (options.embedToken) queryParams.set("embed_token", options.embedToken);
    if (options.theme) queryParams.set("theme", options.theme);
    const qs = queryParams.toString();

    const token = options.morselId && !options.code ? "" : compressEmbedPayload(payload);
    const hashPart = token ? `#m=${token}` : "";
    const iframeSrc = `${origin}/embed/playground${qs ? `?${qs}` : ""}${hashPart}`;

    this.iframe = document.createElement("iframe");
    this.iframe.src = iframeSrc;
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "none";
    this.iframe.setAttribute("allow", "clipboard-read; clipboard-write");

    this.messageHandler = (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== "object") return;
      if (this.iframe.contentWindow && ev.source && ev.source !== this.iframe.contentWindow) {
        return;
      }
      if (this.targetOrigin !== "*" && ev.origin && ev.origin !== "null" && ev.origin !== this.targetOrigin) {
        return;
      }
      const msg = ev.data as EmbedToHostMessage;
      if (!msg.type) return;
      if (msg.type === "EMBED_READY") {
        this.isReady = true;
        this.flushPendingMessages();
      }
      this.emit(msg.type, msg);
    };

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("message", this.messageHandler);
    }
    this.containerEl.appendChild(this.iframe);
  }

  private flushPendingMessages(): void {
    if (!this.iframe.contentWindow || this.pendingMessages.length === 0) return;
    const queue = this.pendingMessages.splice(0, this.pendingMessages.length);
    for (const msg of queue) {
      this.iframe.contentWindow.postMessage(msg, this.targetOrigin);
    }
  }

  public postMessage(msg: HostToEmbedMessage): void {
    if (!this.isReady) {
      this.pendingMessages.push(msg);
    }
    if (this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(msg, this.targetOrigin);
    }
  }

  public setCode(code: string): void {
    this.options.code = code;
    this.postMessage({ type: "SET_CODE", code });
  }

  public setView(view: EmbedViewMode): void {
    this.options.view = view;
    this.postMessage({ type: "SET_VIEW", view });
  }

  public setAnchor(anchor: ModelElementAnchor): void {
    this.options.anchor = anchor;
    this.postMessage({ type: "SET_ANCHOR", anchor });
  }

  public setZoomMode(zoomMode: ZoomInterceptionMode): void {
    this.options.zoomMode = zoomMode;
    this.postMessage({ type: "SET_ZOOM_MODE", zoomMode });
  }

  public setTheme(theme: "dark" | "light"): void {
    this.options.theme = theme;
    this.postMessage({ type: "SET_THEME", theme });
  }

  public setParameters(params: Record<string, number>): void {
    this.postMessage({ type: "SET_PARAMETERS", params });
  }

  public requestExportSvg(): void {
    this.postMessage({ type: "REQUEST_EXPORT_SVG" });
  }

  public triggerSimulate(options?: { stopTime?: number; stepSize?: number }): void {
    if (options !== undefined) {
      this.postMessage({ type: "TRIGGER_SIMULATE", options });
    } else {
      this.postMessage({ type: "TRIGGER_SIMULATE" });
    }
  }

  public getLaunchInfo(): { target: "playground" | "ide"; url: string } {
    const payload: UniversalEmbedPayload = {
      v: 1,
      lang: this.options.dialect,
      code: this.options.code,
      view: this.options.view,
      ...(this.options.anchor ? { anchor: this.options.anchor } : {}),
      ...(this.options.isMultiFile !== undefined ? { isMultiFile: this.options.isMultiFile } : {}),
      ...(this.options.artifactId ? { artifactId: this.options.artifactId } : {}),
    };
    return getLaunchUrl(payload);
  }

  public on<T = unknown>(event: string, handler: EmbedEventHandler<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const typedHandler = handler as EmbedEventHandler<unknown>;
    set.add(typedHandler);
    return () => this.listeners.get(event)?.delete(typedHandler);
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  public destroy(): void {
    window.removeEventListener("message", this.messageHandler);
    this.iframe.remove();
    this.listeners.clear();
  }
}
