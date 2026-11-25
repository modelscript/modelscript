// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host-agnostic contract for decentralized language UI panels.
 *
 * Implemented once per language inside `languages/<lang>/src/ui/` and mounted
 * uniformly across:
 *   1. Ansatz Studio (VS Code Extension Custom Editors / Webviews, `packages/ide`)
 *   2. Ansatz Editor Inspector / Workbench Panes (`apps/web`)
 *   3. Ansatz Network Feed & Package Artifact Cards (`apps/web`)
 */

export type LanguagePanelMode = "workbench" | "inspector" | "artifact";

export type LanguagePanelNotifyLevel = "info" | "warning" | "error";

export interface LanguagePanelHost {
  /** Apply full-document replacement (no-op in read-only artifact mode). */
  onCodeChange?: ((newCode: string) => void) | undefined;
  /** Jump to and highlight a 1-based line or symbol in the active code editor. */
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  /** Write or update a sibling project file (e.g. exported SysML, companion CSV/DYR). */
  onUpdateProjectFile?: ((relativePath: string, content: string) => void) | undefined;
  /** Execute a custom LSP JSON-RPC request against the active language server. */
  requestLsp?: (<R = unknown>(method: string, params?: unknown) => Promise<R>) | undefined;
  /** Trigger a file download (browser) or Save As dialog (VS Code). */
  exportFile?: ((filename: string, content: string | Uint8Array, mimeType?: string) => void) | undefined;
  /** Show a non-blocking status, warning, or error notification. */
  notify?: ((level: LanguagePanelNotifyLevel, message: string) => void) | undefined;
  /** Open the current model in Ansatz Editor (used in Ansatz Network artifact cards). */
  openInAnsatzEditor?: ((code: string, dialect: string, title?: string) => void) | undefined;
  /** Open an external URL in the user's browser. */
  openExternal?: ((url: string) => void) | undefined;
}

export interface LanguagePanelProps {
  /** Raw source text of the active document. */
  code: string;
  /** Language / dialect identifier (e.g. "olga", "psse", "pdb"). */
  dialect: string;
  /** Active color theme. */
  colorMode: "dark" | "light";
  /** Rendering density & interactivity mode. */
  mode: LanguagePanelMode;
  /** Optional document URI or filename (useful for multi-extension formats like .opi/.tpl/.ppl). */
  documentUri?: string | undefined;
  /** Optional sibling workspace files keyed by relative path. */
  projectFiles?: Record<string, string> | undefined;
  /** Optional precomputed metadata from Ansatz artifact records. */
  viewConfig?: Record<string, unknown> | undefined;
  /** Fullscreen flag (used by Ansatz artifact modal). */
  isFullScreen?: boolean | undefined;
  /** Host bridge callbacks. */
  host: LanguagePanelHost;
}

export interface LanguageSimulationCardProps {
  /** Language / dialect identifier. */
  dialect: string;
  /** Active color theme. */
  colorMode: "dark" | "light";
  /** Simulation result payload (time series, metadata, diagnostics). */
  result: Record<string, unknown>;
  /** Optional source code of the simulated model. */
  code?: string | undefined;
  /** Host bridge callbacks. */
  host?: LanguagePanelHost | undefined;
}
