// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelScriptEmbed } from "./client.js";
import type { EmbedDialect, EmbedViewMode, ZoomInterceptionMode } from "./protocol.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/**
 * Custom HTML Web Component: `<modelscript-viewer>`
 *
 * Example usage:
 * ```html
 * <modelscript-viewer
 *   dialect="modelica"
 *   view="diagram"
 *   anchor="R1"
 *   code="model RLC ... end RLC;">
 * </modelscript-viewer>
 * ```
 */
export class ModelScriptViewerElement extends BaseElement {
  private embedClient: ModelScriptEmbed | null = null;
  private shadow?: ShadowRoot;

  constructor() {
    super();
    if (typeof this.attachShadow === "function") {
      this.shadow = this.attachShadow({ mode: "open" });
      const container = document.createElement("div");
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.minHeight = "400px";
      container.style.position = "relative";
      container.style.overflow = "hidden";
      container.style.borderRadius = "8px";
      this.shadow.appendChild(container);
    }
  }

  connectedCallback(): void {
    const dialect = (this.getAttribute("dialect") as EmbedDialect) || "modelica";
    const view = (this.getAttribute("view") as EmbedViewMode) || "diagram";
    const code = this.getAttribute("code") || this.textContent || "";
    const anchorId = this.getAttribute("anchor");
    const isMultiFile = this.hasAttribute("multi-file");
    const artifactId = this.getAttribute("artifact-id") || undefined;
    const origin = this.getAttribute("origin") || undefined;

    const zoomMode = (this.getAttribute("zoom-mode") as ZoomInterceptionMode) || undefined;

    if (!this.shadow) return;
    const container = this.shadow.firstElementChild as HTMLElement;
    if (!container) return;

    this.embedClient = new ModelScriptEmbed({
      container,
      dialect,
      code,
      view,
      isMultiFile,
      ...(anchorId ? { anchor: { elementId: anchorId } } : {}),
      ...(zoomMode ? { zoomMode } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(origin ? { embedOrigin: origin } : {}),
    });
  }

  disconnectedCallback(): void {
    if (this.embedClient) {
      this.embedClient.destroy();
      this.embedClient = null;
    }
  }

  static get observedAttributes(): string[] {
    return ["code", "view", "anchor", "zoom-mode"];
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string): void {
    if (!this.embedClient) return;
    if (name === "code") {
      this.embedClient.setCode(newValue);
    } else if (name === "view") {
      this.embedClient.setView(newValue as EmbedViewMode);
    } else if (name === "anchor") {
      this.embedClient.setAnchor({ elementId: newValue });
    } else if (name === "zoom-mode") {
      this.embedClient.setZoomMode(newValue as ZoomInterceptionMode);
    }
  }
}

// Automatically define custom element if in browser environment
if (typeof customElements !== "undefined" && !customElements.get("modelscript-viewer")) {
  customElements.define("modelscript-viewer", ModelScriptViewerElement);
}
