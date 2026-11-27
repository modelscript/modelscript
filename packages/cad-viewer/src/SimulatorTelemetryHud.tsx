// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Composable Non-VR Field-Simulator Telemetry HUD Overlay.
 *
 * Renders Pelagos-style live top telemetry bar (Model code, Jet Load gauge,
 * Sim ID, Runtime clock, live Status badge), left telemetry column (Thrust
 * sparkline, Motor thermal segmented bar, 8-arm curling % bar array), and
 * right Depth / Attitude artificial horizon card driven by `SampledTelemetryFrame`.
 */

import type {
  SampledBarArrayWidget,
  SampledHorizonWidget,
  SampledSegmentedBarWidget,
  SampledSparklineWidget,
  SampledTelemetryFrame,
  SampledTelemetryWidget,
} from "@modelscript/cad";
import React, { useState } from "react";
import { formatRuntimeClock } from "./telemetry-canvas-painter";

export interface SimulatorTelemetryHudProps {
  readonly frame: SampledTelemetryFrame;
  readonly visible?: boolean | undefined;
  readonly dark?: boolean | undefined;
  /** Optional right-side slot rendered directly beneath the horizon widget (e.g., AssemblyInspectorPanel). */
  readonly rightExtraSlot?: React.ReactNode | undefined;
  /** Live playback toggle state for the bottom Operation Log bar. */
  readonly isPlaying?: boolean | undefined;
  /** Play/pause toggle handler for the bottom Operation Log bar. */
  readonly onTogglePlaying?: (() => void) | undefined;
  /** Seek handler invoked when clicking the Operation Log track, phase bands, or operator action pins. */
  readonly onSeek?: ((time: number) => void) | undefined;
  /** Optional top clearance in px (e.g. below a top host bar). */
  readonly topOffsetPx?: number | undefined;
  /** Optional bottom clearance in px (e.g. above a bottom control dock). */
  readonly bottomOffsetPx?: number | undefined;
}

function SparklineCard({
  widget,
  cardStyle,
  muted,
  fg,
}: {
  widget: SampledSparklineWidget;
  cardStyle: React.CSSProperties;
  muted: string;
  fg: string;
}): React.ReactElement {
  const span = Math.max(1e-6, widget.max - widget.min);
  const w = 152;
  const h = 44;
  const points = widget.samples
    .map((v, i) => {
      const x = (i / Math.max(1, widget.samples.length - 1)) * w;
      const norm = Math.max(0, Math.min(1, (v - widget.min) / span));
      const y = h - 4 - norm * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastVal = widget.samples[widget.samples.length - 1] ?? widget.value;
  const lastY = h - 4 - Math.max(0, Math.min(1, (lastVal - widget.min) / span)) * (h - 8);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 9, color: muted, fontWeight: 700 }}>{widget.code}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: fg }}>
          {widget.value.toFixed(1)} <span style={{ fontSize: 10, color: muted }}>{widget.unit}</span>
        </span>
      </div>
      <div style={{ fontSize: 8.5, letterSpacing: "0.08em", color: muted, marginBottom: 4 }}>{widget.label}</div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <line x1={0} y1={h - 4} x2={w} y2={h - 4} stroke="rgba(148,163,184,0.22)" strokeWidth={1} />
        <polyline fill="none" stroke={widget.accentColor} strokeWidth={1.8} points={points} />
        <circle cx={w} cy={lastY} r={3} fill={widget.accentColor} />
      </svg>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: widget.accentColor, marginTop: 2 }}>
        {widget.statusLabel}
      </div>
    </div>
  );
}

function SegmentedBarCard({
  widget,
  cardStyle,
  muted,
  fg,
}: {
  widget: SampledSegmentedBarWidget;
  cardStyle: React.CSSProperties;
  muted: string;
  fg: string;
}): React.ReactElement {
  const litCount = Math.round(widget.normalized * widget.segments);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: muted, fontWeight: 700 }}>
          {widget.code} · {widget.label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: widget.isWarning ? "#f97316" : fg }}>
          {Math.round(widget.value)} {widget.unit}
        </span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: widget.segments }, (_, i) => {
          const active = i < litCount;
          const color = active ? (i >= widget.segments - 2 ? "#f97316" : widget.accentColor) : "rgba(148,163,184,0.2)";
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 12,
                borderRadius: 2,
                background: color,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function BarArrayCard({
  widget,
  cardStyle,
  muted,
  fg,
}: {
  widget: SampledBarArrayWidget;
  cardStyle: React.CSSProperties;
  muted: string;
  fg: string;
}): React.ReactElement {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: muted, fontWeight: 700 }}>{widget.code}</span>
        {widget.badge && (
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 4,
              background: "rgba(16, 185, 129, 0.2)",
              color: "#10b981",
            }}
          >
            {widget.badge}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {widget.bars.map((bar) => (
          <div key={bar.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 22, fontSize: 8.5, color: bar.attached ? muted : "#38bdf8", fontWeight: 700 }}>
              {bar.label}
            </span>
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: "rgba(148,163,184,0.2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.round(bar.normalized * 100)}%`,
                  height: "100%",
                  background: bar.attached ? widget.accentColor : "#38bdf8",
                }}
              />
            </div>
            <span
              style={{
                width: 30,
                textAlign: "right",
                fontSize: 8.5,
                fontWeight: 700,
                color: bar.attached ? fg : "#38bdf8",
              }}
            >
              {bar.attached ? `${Math.round(bar.value)}%` : "FREE"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizonCard({
  widget,
  cardStyle,
  muted,
  fg,
}: {
  widget: SampledHorizonWidget;
  cardStyle: React.CSSProperties;
  muted: string;
  fg: string;
}): React.ReactElement {
  const pitchOffset = Math.max(-20, Math.min(20, widget.pitchDeg * 0.65));
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: muted }}>{widget.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: fg }}>
          {widget.depth.toFixed(1)} {widget.depthUnit}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
        <svg width={76} height={76} viewBox="0 0 76 76">
          <defs>
            <clipPath id={`horizon-clip-${widget.id}`}>
              <circle cx={38} cy={38} r={34} />
            </clipPath>
          </defs>
          <g clipPath={`url(#horizon-clip-${widget.id})`}>
            <g transform={`translate(38 38) rotate(${-widget.rollDeg}) translate(-38 -38)`}>
              <rect x={-10} y={-10} width={96} height={48 + pitchOffset} fill="rgba(148,163,184,0.16)" />
              <rect x={-10} y={38 + pitchOffset} width={96} height={58} fill="rgba(14,116,144,0.34)" />
              <line x1={0} y1={38 + pitchOffset} x2={76} y2={38 + pitchOffset} stroke="#38bdf8" strokeWidth={1.5} />
            </g>
          </g>
          <circle cx={38} cy={38} r={34} fill="none" stroke="rgba(148,163,184,0.4)" strokeWidth={1.2} />
          <line x1={26} y1={38} x2={34} y2={38} stroke="#f97316" strokeWidth={2} />
          <line x1={42} y1={38} x2={50} y2={38} stroke="#f97316" strokeWidth={2} />
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: muted }}>
        <span>HOLD</span>
        <span style={{ fontWeight: 700, color: widget.holdActive ? "#22c55e" : fg }}>
          {widget.holdActive ? "ON" : "OFF"}
        </span>
      </div>
    </div>
  );
}

function renderWidget(
  widget: SampledTelemetryWidget,
  cardStyle: React.CSSProperties,
  muted: string,
  fg: string,
): React.ReactElement {
  switch (widget.kind) {
    case "sparkline":
      return <SparklineCard key={widget.id} widget={widget} cardStyle={cardStyle} muted={muted} fg={fg} />;
    case "segmented-bar":
      return <SegmentedBarCard key={widget.id} widget={widget} cardStyle={cardStyle} muted={muted} fg={fg} />;
    case "bar-array":
      return <BarArrayCard key={widget.id} widget={widget} cardStyle={cardStyle} muted={muted} fg={fg} />;
    case "horizon":
      return <HorizonCard key={widget.id} widget={widget} cardStyle={cardStyle} muted={muted} fg={fg} />;
  }
}

export const SimulatorTelemetryHud: React.FC<SimulatorTelemetryHudProps> = ({
  frame,
  visible = true,
  dark = true,
  rightExtraSlot,
  isPlaying = true,
  onTogglePlaying,
  onSeek,
  topOffsetPx = 10,
  bottomOffsetPx = 12,
}) => {
  const [logOpen, setLogOpen] = useState(false);

  if (!visible) return null;

  const border = dark ? "rgba(148, 163, 184, 0.24)" : "rgba(15, 23, 42, 0.14)";
  const bg = dark ? "rgba(13, 17, 23, 0.8)" : "rgba(255, 255, 255, 0.84)";
  const fg = dark ? "#f8fafc" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";
  const dur = Math.max(0.1, frame.durationSec);
  const playheadPct = Math.max(0, Math.min(100, (frame.time / dur) * 100));
  const railTop = topOffsetPx + 56;

  const cardStyle: React.CSSProperties = {
    borderRadius: 9,
    border: `1px solid ${border}`,
    background: bg,
    padding: "8px 10px",
    backdropFilter: "blur(8px)",
    boxShadow: "0 6px 18px rgba(0,0,0,0.14)",
    pointerEvents: "auto",
  };

  const handleTrackSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(norm * dur);
  };

  return (
    <div
      data-testid="simulator-telemetry-hud"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 14,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: fg,
      }}
    >
      {/* Top telemetry header bar */}
      <div
        style={{
          position: "absolute",
          top: topOffsetPx,
          left: 12,
          right: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          padding: "7px 12px",
          borderRadius: 10,
          border: `1px solid ${border}`,
          background: bg,
          backdropFilter: "blur(10px)",
          pointerEvents: "auto",
        }}
      >
        <div style={{ minWidth: 165 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.02em" }}>
            {frame.modelCode} <span style={{ color: "#f97316" }}>/</span>
          </div>
          <div style={{ fontSize: 8.5, letterSpacing: "0.07em", color: muted }}>{frame.modelSubtitle}</div>
        </div>

        {/* Center Load Gauge */}
        <div style={{ flex: 1, maxWidth: 320 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", fontSize: 8.5, color: muted, marginBottom: 3 }}
          >
            <span>{frame.loadLabel}</span>
            <span style={{ color: fg, fontWeight: 700 }}>{frame.loadPercent}%</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "rgba(148,163,184,0.22)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${frame.loadPercent}%`,
                height: "100%",
                background: frame.loadPercent > 70 ? "#f97316" : "#38bdf8",
                transition: "width 80ms linear",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7.5, color: muted, marginTop: 2 }}>
            {frame.loadTicks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>

        {/* Right Sim ID, Runtime, Live Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 9.5 }}>
          <div>
            <div style={{ fontSize: 8, color: muted }}>SIM ID</div>
            <div style={{ fontWeight: 700 }}>{frame.simId}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: muted }}>RUNTIME</div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              00:{formatRuntimeClock(frame.time)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              borderRadius: 6,
              border: `1px solid ${frame.statusColor}88`,
              background: `${frame.statusColor}1c`,
              fontWeight: 700,
              color: frame.statusColor,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: frame.statusColor,
              }}
            />
            {frame.statusLabel}
          </div>
        </div>
      </div>

      {/* Left telemetry rail */}
      <div
        style={{
          position: "absolute",
          top: railTop,
          left: 12,
          width: 174,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {frame.leftWidgets.map((w) => renderWidget(w, cardStyle, muted, fg))}
        {frame.activePhase && (
          <div style={{ padding: "4px 6px" }}>
            <div style={{ fontSize: 8, letterSpacing: "0.08em", color: muted }}>OPERATION</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: frame.activePhase.color, letterSpacing: "0.04em" }}>
              {frame.statusLabel}
            </div>
          </div>
        )}
      </div>

      {/* Right rail (Depth horizon + optional AssemblyInspectorPanel) */}
      <div
        style={{
          position: "absolute",
          top: railTop,
          right: 12,
          width: 224,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {frame.rightWidgets.map((w) => renderWidget(w, cardStyle, muted, fg))}
        {rightExtraSlot}
      </div>

      {/* Bottom Pelagos-style OPERATION LOG Scrubber Bar */}
      {(frame.missionPhases.length > 0 || frame.operationLog.length > 0) && (
        <div
          data-testid="hud-operation-log-bar"
          style={{
            position: "absolute",
            bottom: bottomOffsetPx,
            left: 196,
            right: 246,
            minWidth: 280,
            borderRadius: 10,
            border: `1px solid ${border}`,
            background: bg,
            backdropFilter: "blur(10px)",
            padding: "7px 10px 8px",
            boxShadow: "0 8px 22px rgba(0,0,0,0.22)",
            pointerEvents: "auto",
          }}
        >
          {/* Expandable Operator Actions Drawer */}
          {logOpen && frame.operationLog.length > 0 && (
            <div
              data-testid="hud-op-log-drawer"
              style={{
                marginBottom: 7,
                maxHeight: 156,
                overflowY: "auto",
                borderRadius: 7,
                border: `1px solid ${border}`,
                background: dark ? "rgba(9, 13, 22, 0.94)" : "rgba(248, 250, 252, 0.96)",
                padding: "4px 6px",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              {frame.operationLog.map((ev) => {
                const isNear = Math.abs(frame.time - ev.time) < 0.75;
                const badgeColor =
                  ev.category === "fault" || ev.category === "breach"
                    ? "#ef4444"
                    : ev.category === "autonomy"
                      ? "#06b6d4"
                      : "#f97316";
                return (
                  <button
                    key={ev.id}
                    type="button"
                    data-testid={`hud-op-drawer-item-${ev.id}`}
                    onClick={() => onSeek?.(ev.time)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "3px 6px",
                      borderRadius: 5,
                      border: isNear ? `1px solid ${badgeColor}88` : "1px solid transparent",
                      background: isNear ? `${badgeColor}1f` : "transparent",
                      color: fg,
                      fontFamily: "inherit",
                      fontSize: 9.5,
                      textAlign: "left",
                      cursor: onSeek ? "pointer" : "default",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ color: badgeColor, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {formatRuntimeClock(ev.time)}
                      </span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{ev.label}</span>
                      {ev.detail && (
                        <span
                          style={{
                            color: muted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ev.detail}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: badgeColor,
                        flexShrink: 0,
                      }}
                    >
                      {ev.category}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Header Strip: Play/Pause, Active Mission Phase, Clock, Drawer Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 6,
              fontSize: 9,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <button
                type="button"
                data-testid="hud-op-log-play"
                aria-label={isPlaying ? "Pause mission playback" : "Play mission playback"}
                onClick={onTogglePlaying}
                style={{
                  border: `1px solid ${border}`,
                  background: isPlaying ? "rgba(56, 189, 248, 0.2)" : "rgba(249, 115, 22, 0.2)",
                  color: fg,
                  borderRadius: 5,
                  padding: "2px 7px",
                  fontSize: 9.5,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: onTogglePlaying ? "pointer" : "default",
                }}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <span style={{ fontWeight: 800, letterSpacing: "0.08em", color: muted }}>OPERATION LOG</span>
              {frame.activePhase && (
                <span
                  data-testid="hud-op-log-active-phase"
                  style={{
                    fontWeight: 800,
                    color: frame.activePhase.color,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  · {frame.activePhase.label}
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span
                data-testid="hud-op-log-clock"
                style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: fg }}
              >
                {formatRuntimeClock(frame.time)} / {formatRuntimeClock(dur)}
              </span>
              {frame.operationLog.length > 0 && (
                <button
                  type="button"
                  data-testid="hud-op-log-drawer-btn"
                  onClick={() => setLogOpen((prev) => !prev)}
                  style={{
                    border: `1px solid ${border}`,
                    background: logOpen ? "rgba(249, 115, 22, 0.2)" : "transparent",
                    color: logOpen ? "#f97316" : muted,
                    borderRadius: 5,
                    padding: "2px 6px",
                    fontSize: 8.5,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {frame.operationLog.length} OPERATOR ACTIONS {logOpen ? "▾" : "▸"}
                </button>
              )}
            </div>
          </div>

          {/* Interactive Phase-Banded Scrubber + 8 Clickable Operator Action Pins */}
          <div
            data-testid="hud-op-log-scrubber"
            onClick={handleTrackSeek}
            style={{
              position: "relative",
              height: 22,
              borderRadius: 5,
              background: "rgba(148, 163, 184, 0.14)",
              cursor: onSeek ? "pointer" : "default",
              overflow: "visible",
            }}
          >
            {/* Mission Phase Bands */}
            {frame.missionPhases.map((phase) => {
              const leftPct = (phase.startTime / dur) * 100;
              const widthPct = Math.max(1, ((phase.endTime - phase.startTime) / dur) * 100);
              const isActivePhase = frame.activePhase?.id === phase.id;
              return (
                <button
                  key={phase.id}
                  type="button"
                  data-testid={`hud-op-phase-${phase.id}`}
                  title={`${phase.label} (${formatRuntimeClock(phase.startTime)}–${formatRuntimeClock(phase.endTime)})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek?.(phase.startTime + 0.05);
                  }}
                  style={{
                    position: "absolute",
                    top: 2,
                    bottom: 2,
                    left: `${leftPct}%`,
                    width: `calc(${widthPct}% - 2px)`,
                    borderRadius: 4,
                    border: `1px solid ${isActivePhase ? phase.color : `${phase.color}77`}`,
                    background: isActivePhase ? `${phase.color}44` : `${phase.color}24`,
                    color: fg,
                    fontSize: 7.5,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    padding: "0 4px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    cursor: onSeek ? "pointer" : "default",
                  }}
                >
                  {phase.label}
                </button>
              );
            })}

            {/* Operator Action Keyframe Pins */}
            {frame.operationLog.map((ev) => {
              const pct = Math.max(0, Math.min(100, (ev.time / dur) * 100));
              const pinColor =
                ev.category === "fault" || ev.category === "breach"
                  ? "#ef4444"
                  : ev.category === "autonomy"
                    ? "#06b6d4"
                    : "#f97316";
              return (
                <button
                  key={ev.id}
                  type="button"
                  data-testid={`hud-op-event-${ev.id}`}
                  aria-label={`${formatRuntimeClock(ev.time)} ${ev.label}`}
                  title={`${formatRuntimeClock(ev.time)} · ${ev.label}${ev.detail ? ` — ${ev.detail}` : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek?.(ev.time);
                  }}
                  style={{
                    position: "absolute",
                    left: `${pct}%`,
                    bottom: -4,
                    transform: "translateX(-50%) rotate(45deg)",
                    width: 8,
                    height: 8,
                    padding: 0,
                    borderRadius: 1.5,
                    border: `1px solid ${dark ? "#0f172a" : "#ffffff"}`,
                    background: pinColor,
                    cursor: onSeek ? "pointer" : "default",
                    zIndex: 3,
                  }}
                />
              );
            })}

            {/* Live Playhead Cursor */}
            <div
              style={{
                position: "absolute",
                top: -2,
                bottom: -2,
                left: `${playheadPct}%`,
                width: 2,
                transform: "translateX(-50%)",
                background: "#f8fafc",
                boxShadow: "0 0 8px rgba(249, 115, 22, 0.9)",
                pointerEvents: "none",
                zIndex: 4,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
