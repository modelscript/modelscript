// SPDX-License-Identifier: AGPL-3.0-or-later

import { hitTestScatterBrush } from "../../widgets/canvas-plot.js";
import type { SimulationTimelineStore } from "../animation-engine.js";
import type { UnifiedGraphOptions } from "./cell.js";
import type { UnifiedCanvasWidgetSpec } from "./types.js";

export interface SimulationWidgetsHost {
  readonly widgets: Map<string, UnifiedCanvasWidgetSpec>;
  readonly options: UnifiedGraphOptions;
  readonly timelineStore: SimulationTimelineStore;
  isDisposed: () => boolean;
  renderWidgetCanvasDom: () => void;
  scheduleCanvas2DRender: () => void;
  tickAnimations: (frame: Float64Array, dtSeconds?: number) => number;
  emit: (event: string, args?: unknown) => void;
}

export interface SimulationPlaybackState {
  simPlaybackRafId: number | null;
  simLastFrameMs: number;
  hasLoadedSimulation: boolean;
}

export function setWidgetPositionInHost(host: SimulationWidgetsHost, widgetId: string, x: number, y: number): boolean {
  const w = host.widgets.get(widgetId);
  if (!w) return false;
  w.bounds = { ...w.bounds, x, y };
  host.renderWidgetCanvasDom();
  host.scheduleCanvas2DRender();
  return true;
}

export function setWidgetSizeInHost(
  host: SimulationWidgetsHost,
  widgetId: string,
  width: number,
  height: number,
): boolean {
  const w = host.widgets.get(widgetId);
  if (!w) return false;
  w.bounds = { ...w.bounds, width: Math.max(100, width), height: Math.max(60, height) };
  host.renderWidgetCanvasDom();
  host.scheduleCanvas2DRender();
  return true;
}

export function setWidgetTetherInHost(
  host: SimulationWidgetsHost,
  widgetId: string,
  target: { x: number; y: number; label?: string | undefined } | undefined,
): boolean {
  const w = host.widgets.get(widgetId);
  if (!w) return false;
  w.tetherTarget = target;
  if (w.plot) w.plot.tetherTarget = target;
  if (w.sticky) w.sticky.tetherTarget = target;
  host.renderWidgetCanvasDom();
  host.scheduleCanvas2DRender();
  return true;
}

export function brushPlotWidgetInHost(
  host: SimulationWidgetsHost,
  widgetId: string,
  brushRect: { x0: number; y0: number; x1: number; y1: number } | undefined,
): { indices: number[]; linkedIds: string[] } {
  const w = host.widgets.get(widgetId);
  if (!w || w.kind !== "plot" || !w.plot) return { indices: [], linkedIds: [] };
  w.plot.brushRect = brushRect;
  const hit = brushRect
    ? hitTestScatterBrush(w.plot, w.bounds.x, w.bounds.y, w.bounds.width, w.bounds.height, brushRect)
    : { indices: [], linkedIds: [] };

  for (const other of host.widgets.values()) {
    if (other.kind === "table" && other.table) {
      other.table.highlightedRowIds = hit.linkedIds.length > 0 ? hit.linkedIds : undefined;
    }
  }
  host.renderWidgetCanvasDom();
  host.scheduleCanvas2DRender();
  host.options.onWidgetBrush?.(widgetId, hit.indices, hit.linkedIds);
  host.emit("widget:brushed", { widgetId, indices: hit.indices, linkedIds: hit.linkedIds });
  return hit;
}

export function syncPlotCrosshairInHost(host: SimulationWidgetsHost, time: number | undefined): void {
  for (const w of host.widgets.values()) {
    if (w.kind === "plot" && w.plot) {
      w.plot.crosshairX = time;
    }
  }
  host.renderWidgetCanvasDom();
  host.scheduleCanvas2DRender();
}

export function loadSimulationResultInHost(
  host: SimulationWidgetsHost,
  state: SimulationPlaybackState,
  result: { time: ArrayLike<number>; signals: Record<string, ArrayLike<number>> },
): void {
  const timeArr = result.time instanceof Float64Array ? result.time : Float64Array.from(result.time);
  const signalsF64: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(result.signals)) {
    signalsF64[k] = v instanceof Float64Array ? v : Float64Array.from(v);
  }
  host.timelineStore.loadTrajectories(timeArr, signalsF64);
  state.hasLoadedSimulation = timeArr.length > 0;
  const st = host.timelineStore.getState();
  const frame = host.timelineStore.getCurrentFrame();
  if (frame.length > 0) {
    host.tickAnimations(frame, 0);
  }
  syncPlotCrosshairInHost(host, st.currentTime);
  host.emit("simulation:loaded", { start: st.startTime, end: st.endTime, current: st.currentTime });
}

export function playSimulationInHost(host: SimulationWidgetsHost, state: SimulationPlaybackState, speed = 1): void {
  host.timelineStore.setPlaybackRate(speed);
  host.timelineStore.setPlaying(true);
  if (state.simPlaybackRafId !== null || typeof requestAnimationFrame !== "function") return;
  state.simLastFrameMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  const step = (now: number) => {
    if (host.isDisposed() || !host.timelineStore.getState().playing) {
      state.simPlaybackRafId = null;
      return;
    }
    const dtSec = Math.max(0, Math.min(0.1, (now - state.simLastFrameMs) / 1000));
    state.simLastFrameMs = now;
    const st = host.timelineStore.advance(dtSec);
    const frame = host.timelineStore.getCurrentFrame();
    if (frame.length > 0) {
      host.tickAnimations(frame, dtSec);
    }
    syncPlotCrosshairInHost(host, st.currentTime);
    host.emit("simulation:tick", { time: st.currentTime, frame, playing: st.playing });
    state.simPlaybackRafId = requestAnimationFrame(step);
  };
  state.simPlaybackRafId = requestAnimationFrame(step);
}

export function pauseSimulationInHost(host: SimulationWidgetsHost, state: SimulationPlaybackState): void {
  host.timelineStore.setPlaying(false);
  if (state.simPlaybackRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.simPlaybackRafId);
    state.simPlaybackRafId = null;
  }
}

export function seekSimulationInHost(host: SimulationWidgetsHost, time: number): void {
  const st = host.timelineStore.seek(time);
  const frame = host.timelineStore.getCurrentFrame();
  if (frame.length > 0) {
    host.tickAnimations(frame, 0);
  }
  syncPlotCrosshairInHost(host, st.currentTime);
  host.emit("simulation:tick", { time: st.currentTime, frame, playing: st.playing });
}
