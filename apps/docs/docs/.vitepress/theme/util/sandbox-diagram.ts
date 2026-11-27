// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client-only AntV X6 diagram renderer wrapper for the VitePress Polyglot Sandbox,
 * using the exact same `@modelscript/diagram` engine (`initGraph` + `renderDiagram`)
 * as Ansatz Editor.
 */

export interface SandboxDiagramHandle {
  readonly container: HTMLElement;
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
  const { setDiagramOptions, initGraph, renderDiagram, disposeDiagram } = diagramMod;

  let lastData: any = null;
  let lastLanguage: string | undefined;
  let graph: ReturnType<typeof initGraph> = null;
  let fitRafId: number | null = null;
  let lastMeasuredW = 0;
  let lastMeasuredH = 0;

  const ensureInitialized = (isDark: boolean, language?: string) => {
    setDiagramOptions({
      container,
      isDark,
      language,
      preferWebGpu: false,
    });
    graph = initGraph(isDark, container);
    return graph;
  };

  ensureInitialized(initialDark);

  const fitGraph = () => {
    const g = graph;
    if (!g || g.disposed || !container.isConnected) return;
    try {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (w !== lastMeasuredW || h !== lastMeasuredH) {
        lastMeasuredW = w;
        lastMeasuredH = h;
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

  const scheduleFit = () => {
    if (fitRafId !== null) cancelAnimationFrame(fitRafId);
    fitRafId = requestAnimationFrame(() => {
      fitRafId = null;
      fitGraph();
    });
  };

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      if (Math.abs(rect.width - lastMeasuredW) < 2 && Math.abs(rect.height - lastMeasuredH) < 2) return;
      scheduleFit();
    });
    resizeObserver.observe(container);
  }

  return {
    container,
    render(data: any, isDark: boolean, language?: string) {
      lastData = data;
      lastLanguage = language;
      const g = ensureInitialized(isDark, language);
      if (g && !g.disposed) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0 && (w !== lastMeasuredW || h !== lastMeasuredH)) {
          lastMeasuredW = w;
          lastMeasuredH = h;
          g.resize(w, h);
        }
      }
      renderDiagram({ ...data, readOnly: true }, isDark);
      scheduleFit();

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
        scheduleFit();
      } else {
        ensureInitialized(isDark, lastLanguage);
      }
    },
    resize() {
      lastMeasuredW = 0;
      lastMeasuredH = 0;
      fitGraph();
    },
    zoomToFit() {
      fitGraph();
    },
    dispose() {
      if (fitRafId !== null) {
        cancelAnimationFrame(fitRafId);
        fitRafId = null;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      graph = null;
      try {
        disposeDiagram(container);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}
