// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client-only AntV X6 diagram renderer wrapper for the VitePress Polyglot Sandbox,
 * using the exact same `@modelscript/diagram` engine (`initGraph` + `renderDiagram`)
 * as Ansatz Editor.
 */

export interface SandboxDiagramHandle {
  render(data: any, isDark: boolean, language?: string): { nodeCount: number; edgeCount: number };
  setTheme(isDark: boolean): void;
  resize(): void;
  zoomToFit(): void;
  dispose(): void;
}

export function hasDiagramElements(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  if (Array.isArray(data.nodes) && data.nodes.length > 0) return true;
  if (Array.isArray(data.cells) && data.cells.length > 0) return true;
  return false;
}

export async function mountSandboxDiagram(container: HTMLElement, initialDark: boolean): Promise<SandboxDiagramHandle> {
  const diagramMod = await import("@modelscript/diagram");
  const { setDiagramOptions, initGraph, renderDiagram, disposeDiagram, getGraph } = diagramMod;

  let lastData: any = null;
  let lastLanguage: string | undefined;

  const ensureInitialized = (isDark: boolean, language?: string) => {
    setDiagramOptions({
      container,
      isDark,
      language,
    });
    return initGraph(isDark, container);
  };

  ensureInitialized(initialDark);

  const fitGraph = () => {
    const g = getGraph();
    if (!g || g.disposed) return;
    try {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        g.resize(w, h);
      }
      if (g.getCells().length > 0) {
        g.zoomToFit({ padding: 20, maxScale: 1 });
        g.centerContent();
      }
    } catch {
      // ignore if container is hidden
    }
  };

  return {
    render(data: any, isDark: boolean, language?: string) {
      lastData = data;
      lastLanguage = language;
      ensureInitialized(isDark, language);
      renderDiagram({ ...data, readOnly: true }, isDark);
      requestAnimationFrame(() => fitGraph());

      const nodeCount = Array.isArray(data?.nodes)
        ? data.nodes.length
        : Array.isArray(data?.cells)
          ? data.cells.filter((c: any) => c?.shape !== "edge" && !c?.source).length
          : 0;
      const edgeCount = Array.isArray(data?.edges)
        ? data.edges.length
        : Array.isArray(data?.cells)
          ? data.cells.filter((c: any) => c?.shape === "edge" || Boolean(c?.source)).length
          : 0;
      return { nodeCount, edgeCount };
    },
    setTheme(isDark: boolean) {
      if (lastData && hasDiagramElements(lastData)) {
        ensureInitialized(isDark, lastLanguage);
        renderDiagram({ ...lastData, readOnly: true }, isDark);
        requestAnimationFrame(() => fitGraph());
      } else {
        ensureInitialized(isDark, lastLanguage);
      }
    },
    resize() {
      const g = getGraph();
      if (!g || g.disposed) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        g.resize(w, h);
        if (g.getCells().length > 0) {
          g.zoomToFit({ padding: 20, maxScale: 1 });
          g.centerContent();
        }
      }
    },
    zoomToFit() {
      fitGraph();
    },
    dispose() {
      try {
        disposeDiagram(container);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}
