// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LspDiagnostic } from "./docs-lsp-client.js";

export interface SandboxMonacoHandle {
  setValue(nextCode: string): void;
  setLanguage(langSlug: string): void;
  setDiagnostics(diagnostics: LspDiagnostic[]): void;
  setTheme(isDark: boolean): void;
  revealRange(startLine: number, startCharacter: number, endLine?: number, endCharacter?: number): void;
  focus(): void;
  layout(): void;
  dispose(): void;
}

export interface MountSandboxMonacoOptions {
  container: HTMLElement;
  initialCode: string;
  langSlug: string;
  isDark: boolean;
  onChange: (nextCode: string) => void;
  onPaste?: (pastedText: string) => void;
}

const XML_DIALECTS = new Set([
  "urdf",
  "reqif",
  "autosar",
  "ssp",
  "sbml",
  "cellml",
  "sbol",
  "sedml",
  "opensim",
  "febio",
  "automationml",
  "opendrive",
  "openscenario",
]);

function mapSlugToBuiltinMonacoLang(slug: string): string {
  const s = slug.toLowerCase();
  if (XML_DIALECTS.has(s)) return "xml";
  if (s === "c" || s === "verilog-a") return "c";
  if (s === "cantera") return "yaml";
  if (s === "epanet" || s === "swmm" || s === "ibis") return "ini";
  if (s === "plcopen" || s === "fortran") return "pascal";
  return "plaintext";
}

let sandboxMonacoPromise: Promise<typeof import("monaco-editor")> | null = null;

async function ensureMonacoLoaded(): Promise<typeof import("monaco-editor")> {
  if (typeof window === "undefined") {
    throw new Error("Monaco Editor can only be loaded in a browser environment.");
  }
  if (!sandboxMonacoPromise) {
    sandboxMonacoPromise = (async () => {
      const [workerMod, monaco] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker").catch(() => null),
        import("monaco-editor"),
      ]);
      const g = globalThis as unknown as { MonacoEnvironment?: { getWorker: () => Worker } };
      if (!g.MonacoEnvironment) {
        g.MonacoEnvironment = {
          getWorker: () => {
            if (workerMod && typeof workerMod.default === "function") {
              return new workerMod.default();
            }
            const blob = new Blob(["self.onmessage = function() {};"], { type: "text/javascript" });
            return new Worker(URL.createObjectURL(blob));
          },
        };
      }
      const win = window as unknown as { __msxMonacoCancelFilter?: boolean };
      if (!win.__msxMonacoCancelFilter) {
        win.__msxMonacoCancelFilter = true;
        window.addEventListener("unhandledrejection", (event) => {
          const reason = event.reason;
          if (
            reason &&
            (reason.name === "Canceled" || reason.message === "Canceled" || reason.name === "CancellationError")
          ) {
            event.preventDefault();
          }
        });
      }
      return monaco;
    })();
  }
  return sandboxMonacoPromise;
}

export async function mountSandboxMonaco(options: MountSandboxMonacoOptions): Promise<SandboxMonacoHandle> {
  const monaco = await ensureMonacoLoaded();
  const model = monaco.editor.createModel(options.initialCode, mapSlugToBuiltinMonacoLang(options.langSlug));
  let suppressChange = false;

  const editor = monaco.editor.create(options.container, {
    model,
    theme: options.isDark ? "vs-dark" : "vs",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    fontSize: 13,
    lineHeight: 19.5,
    fontFamily: "var(--vp-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
    padding: { top: 10, bottom: 10 },
    wordWrap: "on",
    automaticLayout: true,
    renderValidationDecorations: "on",
    hover: { enabled: true, delay: 120 },
  });

  const subChange = model.onDidChangeContent(() => {
    if (suppressChange) return;
    options.onChange(model.getValue());
  });

  const subPaste = editor.onDidPaste((ev) => {
    if (!options.onPaste) return;
    const text = model.getValueInRange(ev.range);
    if (text) options.onPaste(text);
  });

  return {
    setValue(nextCode: string): void {
      if (model.getValue() === nextCode) return;
      suppressChange = true;
      try {
        editor.executeEdits("sandbox-sync", [
          { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
        ]);
      } finally {
        suppressChange = false;
      }
    },
    setLanguage(langSlug: string): void {
      monaco.editor.setModelLanguage(model, mapSlugToBuiltinMonacoLang(langSlug));
    },
    setDiagnostics(diagnostics: LspDiagnostic[]): void {
      const markers: import("monaco-editor").editor.IMarkerData[] = diagnostics.map((d) => ({
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: Math.max(d.range.end.character + 1, d.range.start.character + 2),
        severity:
          d.severity === 2
            ? monaco.MarkerSeverity.Warning
            : d.severity === 3 || d.severity === 4
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Error,
        code: d.code !== undefined ? String(d.code) : undefined,
        message: d.message,
        source: d.source ?? "modelscript-lsp",
      }));
      monaco.editor.setModelMarkers(model, "modelscript-lsp", markers);
    },
    setTheme(isDark: boolean): void {
      monaco.editor.setTheme(isDark ? "vs-dark" : "vs");
    },
    revealRange(startLine: number, startCharacter: number, endLine?: number, endCharacter?: number): void {
      const range = new monaco.Range(
        startLine + 1,
        startCharacter + 1,
        (endLine ?? startLine) + 1,
        Math.max((endCharacter ?? startCharacter) + 1, startCharacter + 2),
      );
      editor.focus();
      editor.revealRangeInCenter(range);
      editor.setSelection(range);
    },
    focus(): void {
      editor.focus();
    },
    layout(): void {
      editor.layout();
    },
    dispose(): void {
      subChange.dispose();
      subPaste.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
