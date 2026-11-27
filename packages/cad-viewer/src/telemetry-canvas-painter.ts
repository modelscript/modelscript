// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Canvas2D Field-Simulator Telemetry & Operation Log Painter.
 *
 * Used by VR `FloatingToolWings` to render live Pelagos-style gauges, sparklines,
 * 8-arm curling bar arrays, depth artificial horizon, subsystem isolation chips,
 * and mission phase scrubbers onto stereo-safe curved 3D CanvasTextures (throttled
 * to 15–20 Hz, zero DOM/WebGL-HTML issues inside WebXR headsets).
 */

import type {
  SampledBarArrayWidget,
  SampledHorizonWidget,
  SampledSegmentedBarWidget,
  SampledSparklineWidget,
  SampledTelemetryFrame,
} from "@modelscript/cad";

const FONT_SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export interface CanvasHitRegion {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly action:
    | { readonly kind: "seek"; readonly time: number }
    | { readonly kind: "isolate"; readonly subsystemId: string | null }
    | { readonly kind: "toggle-ghost" }
    | { readonly kind: "toggle-labels" }
    | { readonly kind: "toggle-turntable" };
}

export function formatRuntimeClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
  lineWidth = 1.5,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function drawSparklineWidget(
  ctx: CanvasRenderingContext2D,
  w: SampledSparklineWidget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawRoundedBox(ctx, x, y, width, height, 14, "rgba(15, 23, 42, 0.72)", "rgba(148, 163, 184, 0.25)");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`${w.code} · ${w.label}`, x + 18, y + 28);

  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 32px ${FONT_MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(`${w.value.toFixed(1)} ${w.unit}`, x + width - 18, y + 34);

  // Sparkline plot area
  const px = x + 18;
  const py = y + 52;
  const pw = width - 36;
  const ph = Math.max(24, height - 86);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, py + ph);
  ctx.lineTo(px + pw, py + ph);
  ctx.stroke();

  const span = Math.max(1e-6, w.max - w.min);
  if (w.samples.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < w.samples.length; i++) {
      const sx = px + (i / (w.samples.length - 1)) * pw;
      const norm = Math.max(0, Math.min(1, (w.samples[i]! - w.min) / span));
      const sy = py + ph - norm * ph;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = w.accentColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Terminal live dot
    const lastNorm = Math.max(0, Math.min(1, (w.samples[w.samples.length - 1]! - w.min) / span));
    ctx.beginPath();
    ctx.arc(px + pw, py + ph - lastNorm * ph, 5, 0, Math.PI * 2);
    ctx.fillStyle = w.accentColor;
    ctx.fill();
  }

  ctx.fillStyle = w.accentColor;
  ctx.font = `700 15px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(w.statusLabel, x + 18, y + height - 12);
}

export function drawSegmentedBarWidget(
  ctx: CanvasRenderingContext2D,
  w: SampledSegmentedBarWidget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawRoundedBox(ctx, x, y, width, height, 14, "rgba(15, 23, 42, 0.72)", "rgba(148, 163, 184, 0.25)");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`${w.code} · ${w.label}`, x + 18, y + 28);

  ctx.fillStyle = w.isWarning ? "#f97316" : "#f8fafc";
  ctx.font = `700 28px ${FONT_MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(w.value)} ${w.unit}`, x + width - 18, y + 32);

  const bx = x + 18;
  const by = y + 48;
  const bw = width - 36;
  const bh = Math.max(16, height - 64);
  const gap = 6;
  const segW = (bw - gap * (w.segments - 1)) / w.segments;
  const litCount = Math.round(w.normalized * w.segments);

  for (let i = 0; i < w.segments; i++) {
    const sx = bx + i * (segW + gap);
    const active = i < litCount;
    const fill = active ? (i >= w.segments - 2 ? "#f97316" : w.accentColor) : "rgba(148, 163, 184, 0.2)";
    drawRoundedBox(ctx, sx, by, segW, bh, 4, fill);
  }
}

export function drawBarArrayWidget(
  ctx: CanvasRenderingContext2D,
  w: SampledBarArrayWidget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawRoundedBox(ctx, x, y, width, height, 14, "rgba(15, 23, 42, 0.72)", "rgba(148, 163, 184, 0.25)");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`${w.code} · ${w.label}`, x + 18, y + 28);

  if (w.badge) {
    drawRoundedBox(ctx, x + width - 134, y + 10, 116, 26, 6, "rgba(16, 185, 129, 0.22)", "#10b981", 1.2);
    ctx.fillStyle = "#34d399";
    ctx.font = `700 14px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.fillText(w.badge, x + width - 76, y + 28);
  }

  const count = Math.max(1, w.bars.length);
  const startY = y + 48;
  const availH = height - 60;
  const rowH = availH / count;

  for (let i = 0; i < w.bars.length; i++) {
    const bar = w.bars[i]!;
    const ry = startY + i * rowH;
    const labelW = 54;
    const valW = 78;
    const trackX = x + 18 + labelW;
    const trackW = width - 36 - labelW - valW;
    const barH = Math.max(8, rowH * 0.46);
    const barY = ry + (rowH - barH) * 0.5;

    ctx.fillStyle = bar.attached ? "#cbd5e1" : "#f59e0b";
    ctx.font = `700 15px ${FONT_MONO}`;
    ctx.textAlign = "left";
    ctx.fillText(bar.label, x + 18, barY + barH - 1);

    drawRoundedBox(ctx, trackX, barY, trackW, barH, 4, "rgba(148, 163, 184, 0.18)");
    drawRoundedBox(
      ctx,
      trackX,
      barY,
      Math.max(4, trackW * bar.normalized),
      barH,
      4,
      bar.attached ? w.accentColor : "#38bdf8",
    );

    ctx.fillStyle = bar.attached ? "#f8fafc" : "#38bdf8";
    ctx.font = `700 15px ${FONT_MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(bar.attached ? `${Math.round(bar.value)}%` : "FREE", x + width - 18, barY + barH - 1);
  }
}

export function drawHorizonWidget(
  ctx: CanvasRenderingContext2D,
  w: SampledHorizonWidget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawRoundedBox(ctx, x, y, width, height, 14, "rgba(15, 23, 42, 0.72)", "rgba(148, 163, 184, 0.25)");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`${w.code} · ${w.label}`, x + 18, y + 28);

  const cx = x + width * 0.32;
  const cy = y + height * 0.58;
  const radius = Math.min(height * 0.34, width * 0.24);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate((-w.rollDeg * Math.PI) / 180);
  const pitchPx = (w.pitchDeg / 35) * radius;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 2 + pitchPx);
  ctx.fillStyle = "#0c4a6e";
  ctx.fillRect(-radius * 2, pitchPx, radius * 4, radius * 2);

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-radius, pitchPx);
  ctx.lineTo(radius, pitchPx);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center aircraft/ROV reticle
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx - 4, cy);
  ctx.moveTo(cx + 4, cy);
  ctx.lineTo(cx + 14, cy);
  ctx.stroke();

  // Right readouts
  const rx = x + width * 0.62;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 28px ${FONT_MONO}`;
  ctx.fillText(`${w.depth.toFixed(1)} ${w.depthUnit}`, rx, y + 66);

  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 15px ${FONT_MONO}`;
  ctx.fillText(`PITCH ${w.pitchDeg >= 0 ? "+" : ""}${w.pitchDeg.toFixed(1)}°`, rx, y + 96);
  ctx.fillText(`ROLL  ${w.rollDeg >= 0 ? "+" : ""}${w.rollDeg.toFixed(1)}°`, rx, y + 118);

  const holdColor = w.holdActive ? "#22c55e" : "#94a3b8";
  ctx.fillStyle = holdColor;
  ctx.font = `700 15px ${FONT_MONO}`;
  ctx.fillText(`HOLD: ${w.holdActive ? "ON" : "OFF"}`, rx, y + 146);
}

export interface TelemetryCanvasSubsystemChip {
  readonly id: string;
  readonly code?: string | undefined;
  readonly label: string;
  readonly accentColor?: string | undefined;
}

export interface TelemetryCanvasOverlayOptions {
  readonly subsystems?: readonly TelemetryCanvasSubsystemChip[] | undefined;
  readonly isolatedSubsystemId?: string | null | undefined;
}

/**
 * Paints a complete live Telemetry + Operation Log summary card onto a VR curved tablet surface.
 * Returns clickable hit regions in canvas pixel coordinates for direct ray/laser interaction.
 */
export function paintTelemetryOverlayToCanvas(
  ctx: CanvasRenderingContext2D,
  frame: SampledTelemetryFrame,
  canvasW: number,
  canvasH: number,
  options?: TelemetryCanvasOverlayOptions,
): CanvasHitRegion[] {
  const hits: CanvasHitRegion[] = [];
  const pad = 34;
  const subsystems = options?.subsystems ?? [];
  const hasSubsystemRow = subsystems.length > 0;
  const isolatedSubsystemId = options?.isolatedSubsystemId ?? null;

  // Header strip: Model code + Jet Load bar + Status badge
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 30px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(frame.modelCode, pad, 56);

  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 16px ${FONT_MONO}`;
  ctx.fillText(
    `${frame.simId} · ${formatRuntimeClock(frame.time)} / ${formatRuntimeClock(frame.durationSec)}`,
    pad,
    82,
  );

  // Live Status Pill
  const badgeW = 196;
  drawRoundedBox(ctx, canvasW - pad - badgeW, 28, badgeW, 42, 10, "rgba(15, 23, 42, 0.85)", frame.statusColor, 2);
  ctx.beginPath();
  ctx.arc(canvasW - pad - badgeW + 22, 49, 6, 0, Math.PI * 2);
  ctx.fillStyle = frame.statusColor;
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(frame.statusLabel.slice(0, 12), canvasW - pad - badgeW + 38, 55);

  // Jet Load gauge bar
  const gaugeY = 102;
  const gaugeW = canvasW - pad * 2;
  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 16px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(frame.loadLabel, pad, gaugeY + 14);
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "right";
  ctx.fillText(`${frame.loadPercent}%`, canvasW - pad, gaugeY + 14);

  const trackY = gaugeY + 24;
  drawRoundedBox(ctx, pad, trackY, gaugeW, 14, 7, "rgba(148, 163, 184, 0.22)");
  drawRoundedBox(
    ctx,
    pad,
    trackY,
    Math.max(10, (gaugeW * frame.loadPercent) / 100),
    14,
    7,
    frame.loadPercent > 70 ? "#f97316" : "#38bdf8",
  );

  // Two-column widget grid
  const bottomReserved = hasSubsystemRow ? 196 : 150;
  const colGap = 20;
  const colW = (gaugeW - colGap) / 2;
  const leftX = pad;
  const rightX = pad + colW + colGap;
  let leftY = 156;
  let rightY = 156;

  for (const w of frame.leftWidgets) {
    const h = w.kind === "bar-array" ? (hasSubsystemRow ? 228 : 260) : w.kind === "sparkline" ? 138 : 90;
    if (leftY + h > canvasH - bottomReserved) break;
    if (w.kind === "sparkline") drawSparklineWidget(ctx, w, leftX, leftY, colW, h);
    else if (w.kind === "segmented-bar") drawSegmentedBarWidget(ctx, w, leftX, leftY, colW, h);
    else if (w.kind === "bar-array") drawBarArrayWidget(ctx, w, leftX, leftY, colW, h);
    else if (w.kind === "horizon") drawHorizonWidget(ctx, w, leftX, leftY, colW, h);
    leftY += h + 12;
  }

  for (const w of frame.rightWidgets) {
    const h = w.kind === "horizon" ? 172 : w.kind === "bar-array" ? 228 : 136;
    if (rightY + h > canvasH - bottomReserved) break;
    if (w.kind === "horizon") drawHorizonWidget(ctx, w, rightX, rightY, colW, h);
    else if (w.kind === "sparkline") drawSparklineWidget(ctx, w, rightX, rightY, colW, h);
    else if (w.kind === "segmented-bar") drawSegmentedBarWidget(ctx, w, rightX, rightY, colW, h);
    else if (w.kind === "bar-array") drawBarArrayWidget(ctx, w, rightX, rightY, colW, h);
    rightY += h + 12;
  }

  // Optional Subsystem Isolation chip row (`HERO` + up to 6 subsystems)
  if (hasSubsystemRow) {
    const chipRowY = canvasH - 180;
    const chipH = 42;
    const chips: Array<{ id: string | null; label: string; accent: string }> = [
      { id: null, label: "HERO", accent: "#38bdf8" },
      ...subsystems.slice(0, 6).map((s) => ({
        id: s.id,
        label: s.code ? `${s.code} ${s.label.split(" ")[0] ?? s.label}` : s.label,
        accent: s.accentColor ?? "#f97316",
      })),
    ];
    const chipGap = 8;
    const chipW = (gaugeW - chipGap * (chips.length - 1)) / chips.length;

    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i]!;
      const cx = pad + i * (chipW + chipGap);
      const isActive = isolatedSubsystemId === chip.id;
      drawRoundedBox(
        ctx,
        cx,
        chipRowY,
        chipW,
        chipH,
        10,
        isActive ? `${chip.accent}38` : "rgba(15, 23, 42, 0.78)",
        isActive ? chip.accent : "rgba(148, 163, 184, 0.28)",
        isActive ? 2 : 1.2,
      );
      ctx.fillStyle = isActive ? "#f8fafc" : "#cbd5e1";
      ctx.font = `700 15px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.fillText(chip.label.slice(0, 10), cx + chipW / 2, chipRowY + 26);

      hits.push({
        id: chip.id === null ? "isolate:hero" : `isolate:${chip.id}`,
        x: cx,
        y: chipRowY,
        w: chipW,
        h: chipH,
        action: { kind: "isolate", subsystemId: chip.id },
      });
    }
  }

  // Operation Log Phase Scrubber at bottom
  const scrubY = canvasH - 126;
  drawRoundedBox(ctx, pad, scrubY, gaugeW, 100, 14, "rgba(15, 23, 42, 0.84)", "rgba(148, 163, 184, 0.3)");

  ctx.fillStyle = "#94a3b8";
  ctx.font = `700 16px ${FONT_MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`OPERATION LOG · ${frame.activePhase?.label ?? "STANDBY"}`, pad + 18, scrubY + 26);
  ctx.textAlign = "right";
  ctx.fillText(`${frame.operationLog.length} EVENTS`, canvasW - pad - 18, scrubY + 26);

  const barX = pad + 18;
  const barY = scrubY + 46;
  const barW = gaugeW - 36;
  const barH = 18;
  const dur = Math.max(0.1, frame.durationSec);

  for (const phase of frame.missionPhases) {
    const sx = barX + (phase.startTime / dur) * barW;
    const sw = Math.max(4, ((phase.endTime - phase.startTime) / dur) * barW - 2);
    drawRoundedBox(ctx, sx, barY, sw, barH, 4, `${phase.color}55`, phase.color, 1);
    hits.push({
      id: `phase-${phase.id}`,
      x: sx,
      y: barY - 8,
      w: sw,
      h: barH + 22,
      action: { kind: "seek", time: phase.startTime + 0.05 },
    });
  }

  // Event ticks
  for (const ev of frame.operationLog) {
    const ex = barX + (ev.time / dur) * barW;
    ctx.beginPath();
    ctx.arc(ex, barY + barH + 14, 5, 0, Math.PI * 2);
    ctx.fillStyle = ev.category === "fault" || ev.category === "breach" ? "#ef4444" : "#f97316";
    ctx.fill();
  }

  // Playhead cursor
  const playX = barX + Math.max(0, Math.min(1, frame.time / dur)) * barW;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(playX - 2, barY - 5, 4, barH + 10);

  return hits;
}
