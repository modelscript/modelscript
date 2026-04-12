// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ECAD Canvas — WebGL2 PCB Rendering Engine.
 *
 * Provides high-performance 2D rendering of PCB layouts with:
 *   - Layer system (Top/Bottom Copper, Silkscreen, Solder Mask, Board Outline)
 *   - Camera pan/zoom with smooth transitions
 *   - Batch rendering of traces, pads, vias, and ratsnest overlay
 *   - Selection highlighting and DRC violation markers
 */

// Re-declared locally to avoid deep import into @modelscript/core internals.
// These mirror the types in @modelscript/ecad.
interface NetlistPin {
  name: string;
  component: string;
  localName: string;
}
interface Net {
  id: string;
  pins: NetlistPin[];
}
interface NetlistComponent {
  name: string;
  pins: string[];
  placement: { footprint: string | null; layer: string; x: number; y: number; angle: number } | null;
}

/** Complete netlist graph for ECAD frontend consumption. */
export interface NetlistGraph {
  nets: Net[];
  components: NetlistComponent[];
  totalPins: number;
  totalConnections: number;
}

// ── Types ──

/** RGBA color as [r, g, b, a] with 0-1 range. */
export type Color = [number, number, number, number];

/** 2D point in board coordinates (mm). */
export interface Point2D {
  x: number;
  y: number;
}

/** Camera state for pan/zoom. */
export interface Camera {
  /** Center of viewport in board coordinates (mm). */
  center: Point2D;
  /** Zoom level (pixels per mm). */
  zoom: number;
  /** Viewport width in pixels. */
  viewportWidth: number;
  /** Viewport height in pixels. */
  viewportHeight: number;
}

/** Layer visibility and rendering configuration. */
export interface LayerConfig {
  name: string;
  visible: boolean;
  color: Color;
  opacity: number;
}

/** A rendered trace segment. */
export interface RenderTrace {
  points: Point2D[];
  width: number;
  layer: string;
  netId: string;
  selected: boolean;
}

/** A rendered pad. */
export interface RenderPad {
  center: Point2D;
  width: number;
  height: number;
  shape: "circle" | "rect" | "oval" | "roundrect";
  layer: string;
  netId: string;
  component: string;
  pinName: string;
  selected: boolean;
}

/** A rendered via. */
export interface RenderVia {
  center: Point2D;
  outerRadius: number;
  drillRadius: number;
  netId: string;
  selected: boolean;
}

/** A ratsnest line (unrouted connection). */
export interface RatsnestLine {
  from: Point2D;
  to: Point2D;
  netId: string;
}

/** DRC violation marker. */
export interface DRCMarker {
  position: Point2D;
  radius: number;
  message: string;
  severity: "error" | "warning";
}

// ── Default layer colors ──

export const DEFAULT_LAYERS: LayerConfig[] = [
  { name: "TopCopper", visible: true, color: [0.8, 0.2, 0.2, 1.0], opacity: 1.0 },
  { name: "BottomCopper", visible: true, color: [0.2, 0.2, 0.8, 1.0], opacity: 0.7 },
  { name: "InnerCopper1", visible: false, color: [0.8, 0.8, 0.2, 1.0], opacity: 0.5 },
  { name: "InnerCopper2", visible: false, color: [0.2, 0.8, 0.2, 1.0], opacity: 0.5 },
  { name: "TopSilkscreen", visible: true, color: [1.0, 1.0, 1.0, 1.0], opacity: 0.9 },
  { name: "BottomSilkscreen", visible: false, color: [0.8, 0.8, 1.0, 1.0], opacity: 0.5 },
  { name: "TopSolderMask", visible: false, color: [0.0, 0.5, 0.0, 0.3], opacity: 0.3 },
  { name: "BottomSolderMask", visible: false, color: [0.0, 0.0, 0.5, 0.3], opacity: 0.3 },
  { name: "BoardOutline", visible: true, color: [0.9, 0.9, 0.0, 1.0], opacity: 1.0 },
];

// ── Renderer ──

/** PCB rendering engine using Canvas 2D (WebGL2 upgrade path). */
export class PCBRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private camera: Camera = {
    center: { x: 0, y: 0 },
    zoom: 10,
    viewportWidth: 800,
    viewportHeight: 600,
  };

  private layers: LayerConfig[] = [...DEFAULT_LAYERS];
  private traces: RenderTrace[] = [];
  private pads: RenderPad[] = [];
  private vias: RenderVia[] = [];
  private ratsnest: RatsnestLine[] = [];
  private drcMarkers: DRCMarker[] = [];
  private boardOutline: Point2D[] = [];

  // Interaction state
  private isDragging = false;
  private lastMouse: Point2D = { x: 0, y: 0 };
  private selectedNetId: string | null = null;

  /**
   * Attach the renderer to a canvas element.
   */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.camera.viewportWidth = canvas.width;
    this.camera.viewportHeight = canvas.height;

    // Set up event listeners
    canvas.addEventListener("wheel", this.onWheel.bind(this));
    canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
    canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
    canvas.addEventListener("mouseup", this.onMouseUp.bind(this));
    canvas.addEventListener("click", this.onClick.bind(this));
  }

  /**
   * Detach renderer from canvas and clean up event listeners.
   */
  detach(): void {
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * Load a netlist graph for ratsnest computation.
   */
  loadNetlist(graph: NetlistGraph): void {
    this.ratsnest = computeRatsnest(graph);
  }

  /**
   * Set the board outline polygon.
   */
  setBoardOutline(vertices: Point2D[]): void {
    this.boardOutline = vertices;
  }

  /**
   * Add trace segments for rendering.
   */
  setTraces(traces: RenderTrace[]): void {
    this.traces = traces;
  }

  /**
   * Add pads for rendering.
   */
  setPads(pads: RenderPad[]): void {
    this.pads = pads;
  }

  /**
   * Add vias for rendering.
   */
  setVias(vias: RenderVia[]): void {
    this.vias = vias;
  }

  /**
   * Set DRC violation markers.
   */
  setDRCMarkers(markers: DRCMarker[]): void {
    this.drcMarkers = markers;
  }

  /**
   * Set layer visibility.
   */
  setLayerVisible(name: string, visible: boolean): void {
    const layer = this.layers.find((l) => l.name === name);
    if (layer) layer.visible = visible;
  }

  /**
   * Render a single frame.
   */
  render(): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    ctx.save();

    // Apply camera transform
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.camera.zoom, -this.camera.zoom); // Flip Y for board coords
    ctx.translate(-this.camera.center.x, -this.camera.center.y);

    // Draw board outline
    if (this.boardOutline.length >= 2) {
      this.drawBoardOutline(ctx);
    }

    // Draw layers bottom-up
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      this.drawLayerTraces(ctx, layer);
      this.drawLayerPads(ctx, layer);
    }

    // Draw vias (all layers)
    ctx.globalAlpha = 1.0;
    this.drawVias(ctx);

    // Draw ratsnest
    this.drawRatsnest(ctx);

    // Draw DRC markers
    this.drawDRCMarkers(ctx);

    ctx.restore();

    // Draw HUD (layer list, coordinates) in screen space
    this.drawHUD(ctx);
  }

  // ── Private drawing methods ──

  private drawBoardOutline(ctx: CanvasRenderingContext2D): void {
    const outline = this.boardOutline;
    if (outline.length < 2) return;
    ctx.strokeStyle = "#e6e600";
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(outline[0]!.x, outline[0]!.y); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    for (let i = 1; i < outline.length; i++) {
      ctx.lineTo(outline[i]!.x, outline[i]!.y); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    ctx.closePath();
    ctx.stroke();

    // Fill board area with dark green
    ctx.fillStyle = "rgba(0, 40, 0, 0.5)";
    ctx.fill();
  }

  private drawLayerTraces(ctx: CanvasRenderingContext2D, layer: LayerConfig): void {
    for (const trace of this.traces) {
      if (trace.layer !== layer.name) continue;
      const [r, g, b] = layer.color;
      const highlight = trace.selected || trace.netId === this.selectedNetId;
      ctx.strokeStyle = highlight
        ? `rgba(255, 255, 100, ${layer.opacity})`
        : `rgba(${Math.round((r ?? 0) * 255)}, ${Math.round((g ?? 0) * 255)}, ${Math.round((b ?? 0) * 255)}, ${layer.opacity})`;
      ctx.lineWidth = trace.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (trace.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(trace.points[0]!.x, trace.points[0]!.y); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        for (let i = 1; i < trace.points.length; i++) {
          ctx.lineTo(trace.points[i]!.x, trace.points[i]!.y); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        ctx.stroke();
      }
    }
  }

  private drawLayerPads(ctx: CanvasRenderingContext2D, layer: LayerConfig): void {
    for (const pad of this.pads) {
      if (pad.layer !== layer.name) continue;
      const [r, g, b] = layer.color;
      const highlight = pad.selected || pad.netId === this.selectedNetId;
      ctx.fillStyle = highlight
        ? `rgba(255, 255, 100, 1.0)`
        : `rgba(${Math.round((r ?? 0) * 255)}, ${Math.round((g ?? 0) * 255)}, ${Math.round((b ?? 0) * 255)}, 1.0)`;

      switch (pad.shape) {
        case "circle":
          ctx.beginPath();
          ctx.arc(pad.center.x, pad.center.y, pad.width / 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "rect":
        case "roundrect":
          ctx.fillRect(pad.center.x - pad.width / 2, pad.center.y - pad.height / 2, pad.width, pad.height);
          break;
        case "oval":
          ctx.beginPath();
          ctx.ellipse(pad.center.x, pad.center.y, pad.width / 2, pad.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
    }
  }

  private drawVias(ctx: CanvasRenderingContext2D): void {
    for (const via of this.vias) {
      const highlight = via.selected || via.netId === this.selectedNetId;

      // Outer ring (annular ring)
      ctx.fillStyle = highlight ? "rgba(255, 255, 100, 1.0)" : "rgba(180, 180, 180, 1.0)";
      ctx.beginPath();
      ctx.arc(via.center.x, via.center.y, via.outerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Drill hole
      ctx.fillStyle = "#1a1a2e";
      ctx.beginPath();
      ctx.arc(via.center.x, via.center.y, via.drillRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRatsnest(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(100, 100, 255, 0.4)";
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.2, 0.2]);

    for (const line of this.ratsnest) {
      ctx.beginPath();
      ctx.moveTo(line.from.x, line.from.y);
      ctx.lineTo(line.to.x, line.to.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  private drawDRCMarkers(ctx: CanvasRenderingContext2D): void {
    for (const marker of this.drcMarkers) {
      ctx.strokeStyle = marker.severity === "error" ? "rgba(255, 0, 0, 0.8)" : "rgba(255, 165, 0, 0.8)";
      ctx.lineWidth = 0.1;

      // Diamond-shaped marker
      const r = marker.radius;
      ctx.beginPath();
      ctx.moveTo(marker.position.x, marker.position.y - r);
      ctx.lineTo(marker.position.x + r, marker.position.y);
      ctx.lineTo(marker.position.x, marker.position.y + r);
      ctx.lineTo(marker.position.x - r, marker.position.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "12px monospace";
    ctx.fillText(
      `Zoom: ${this.camera.zoom.toFixed(1)}x  Center: (${this.camera.center.x.toFixed(1)}, ${this.camera.center.y.toFixed(1)})`,
      10,
      this.canvas.height - 10,
    );
  }

  // ── Event handlers ──

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.camera.zoom = Math.max(0.1, Math.min(1000, this.camera.zoom * factor));
    this.render();
  }

  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.lastMouse = { x: e.clientX, y: e.clientY };
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    const dx = (e.clientX - this.lastMouse.x) / this.camera.zoom;
    const dy = -(e.clientY - this.lastMouse.y) / this.camera.zoom; // Flip Y
    this.camera.center.x -= dx;
    this.camera.center.y -= dy;
    this.lastMouse = { x: e.clientX, y: e.clientY };
    this.render();
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onClick(e: MouseEvent): void {
    if (!this.canvas) return;
    // Convert screen coords to board coords for hit testing
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const bx = (sx - this.canvas.width / 2) / this.camera.zoom + this.camera.center.x;
    const by = -(sy - this.canvas.height / 2) / this.camera.zoom + this.camera.center.y;

    // Hit test pads
    for (const pad of this.pads) {
      const dx = bx - pad.center.x;
      const dy = by - pad.center.y;
      if (Math.sqrt(dx * dx + dy * dy) < pad.width / 2 + 0.5) {
        this.selectedNetId = pad.netId;
        this.render();
        return;
      }
    }

    // Deselect
    this.selectedNetId = null;
    this.render();
  }

  /**
   * Convert board coordinates to screen coordinates.
   */
  boardToScreen(p: Point2D): Point2D {
    if (!this.canvas) return { x: 0, y: 0 };
    return {
      x: (p.x - this.camera.center.x) * this.camera.zoom + this.canvas.width / 2,
      y: -(p.y - this.camera.center.y) * this.camera.zoom + this.canvas.height / 2,
    };
  }

  /**
   * Convert screen coordinates to board coordinates.
   */
  screenToBoard(p: Point2D): Point2D {
    if (!this.canvas) return { x: 0, y: 0 };
    return {
      x: (p.x - this.canvas.width / 2) / this.camera.zoom + this.camera.center.x,
      y: -(p.y - this.canvas.height / 2) / this.camera.zoom + this.camera.center.y,
    };
  }
}

// ── Ratsnest computation ──

/**
 * Compute ratsnest lines (shortest unrouted connections) from a netlist.
 * Uses a simple Prim's MST approach per net.
 */
function computeRatsnest(graph: NetlistGraph): RatsnestLine[] {
  const lines: RatsnestLine[] = [];

  // Build component position map
  const compPositions = new Map<string, Point2D>();
  for (const comp of graph.components) {
    if (comp.placement) {
      compPositions.set(comp.name, { x: comp.placement.x, y: comp.placement.y });
    }
  }

  // For each net, connect pins with minimum spanning tree
  for (const net of graph.nets) {
    if (net.pins.length < 2) continue;

    // Get positions for all pins in this net
    const pinPositions: { pin: string; pos: Point2D }[] = [];
    for (const pin of net.pins) {
      const compPos = compPositions.get(pin.component);
      if (compPos) {
        pinPositions.push({ pin: pin.name, pos: compPos });
      }
    }

    if (pinPositions.length < 2) continue;

    // Prim's MST
    const connected = new Set<number>([0]);
    const remaining = new Set<number>();
    for (let i = 1; i < pinPositions.length; i++) remaining.add(i);

    while (remaining.size > 0) {
      let bestDist = Infinity;
      let bestFrom = 0;
      let bestTo = 0;

      for (const from of connected) {
        for (const to of remaining) {
          const pf = pinPositions[from]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
          const pt = pinPositions[to]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
          const dx = pf.pos.x - pt.pos.x;
          const dy = pf.pos.y - pt.pos.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestFrom = from;
            bestTo = to;
          }
        }
      }

      const fromPin = pinPositions[bestFrom]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const toPin = pinPositions[bestTo]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      lines.push({
        from: fromPin.pos,
        to: toPin.pos,
        netId: net.id,
      });
      connected.add(bestTo);
      remaining.delete(bestTo);
    }
  }

  return lines;
}
