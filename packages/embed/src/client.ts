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
  /** Wheel / scroll zoom interception policy */
  zoomMode?: ZoomInterceptionMode;
}

export type EmbedEventHandler<T = any> = (data: T) => void;

/**
 * High-level programmatic controller for embedded ModelScript artifact viewers.
 */
export class ModelScriptEmbed {
  private iframe: HTMLIFrameElement;
  private containerEl: HTMLElement;
  private options: EmbedOptions;
  private listeners: Map<string, Set<EmbedEventHandler>> = new Map();
  private messageHandler: (e: MessageEvent) => void;

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
    };

    const token = compressEmbedPayload(payload);
    const origin = options.embedOrigin ?? window.location.origin;
    const iframeSrc = `${origin}/embed/playground#m=${token}`;

    this.iframe = document.createElement("iframe");
    this.iframe.src = iframeSrc;
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "none";
    this.iframe.setAttribute("allow", "clipboard-read; clipboard-write");

    this.messageHandler = (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== "object") return;
      const msg = ev.data as EmbedToHostMessage;
      this.emit(msg.type, msg);
    };

    window.addEventListener("message", this.messageHandler);
    this.containerEl.appendChild(this.iframe);
  }

  public postMessage(msg: HostToEmbedMessage): void {
    if (this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(msg, "*");
    }
  }

  public setCode(code: string): void {
    this.postMessage({ type: "SET_CODE", code });
  }

  public setView(view: EmbedViewMode): void {
    this.postMessage({ type: "SET_VIEW", view });
  }

  public setAnchor(anchor: ModelElementAnchor): void {
    this.postMessage({ type: "SET_ANCHOR", anchor });
  }

  public setZoomMode(zoomMode: ZoomInterceptionMode): void {
    this.postMessage({ type: "SET_ZOOM_MODE", zoomMode });
  }

  public setTheme(theme: "dark" | "light"): void {
    this.postMessage({ type: "SET_THEME", theme });
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

  public on<T = any>(event: string, handler: EmbedEventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
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
