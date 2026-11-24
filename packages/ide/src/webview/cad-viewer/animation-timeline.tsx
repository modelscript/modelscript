// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Animation timeline overlay for the CadViewer (VS Code webview variant).
 *
 * Uses plain HTML elements instead of Primer React, since Primer is not
 * available in the VS Code extension webview bundle.
 */

import type { MissionPhaseBand, OperationLogEvent } from "@modelscript/cad";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationController, AnimationState } from "./animation-controller";

interface AnimationTimelineProps {
  controller: AnimationController;
  missionPhases?: readonly MissionPhaseBand[] | undefined;
  operationLog?: readonly OperationLogEvent[] | undefined;
}

const SPEED_OPTIONS = [
  { value: 0.1, label: "0.1×" },
  { value: 0.25, label: "0.25×" },
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 5, label: "5×" },
  { value: 10, label: "10×" },
];

function formatTime(t: number): string {
  if (t < 0.01) return t.toExponential(2);
  if (t < 1) return t.toFixed(3) + "s";
  if (t < 60) return t.toFixed(2) + "s";
  const min = Math.floor(t / 60);
  const sec = (t % 60).toFixed(1);
  return `${min}m ${sec}s`;
}

const btnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--vscode-foreground, #e6edf3)",
  cursor: "pointer",
  padding: "4px 6px",
  borderRadius: 4,
  fontSize: 14,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

export function AnimationTimeline({ controller, missionPhases, operationLog }: AnimationTimelineProps) {
  const [state, setState] = useState<AnimationState>(controller.state);
  const [logExpanded, setLogExpanded] = useState(false);
  const animFrameRef = useRef<number>(0);
  const sliderRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    return controller.onStateChange(setState);
  }, [controller]);

  useEffect(() => {
    if (state.mode !== "playing") {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    const update = () => {
      if (!isDragging.current && sliderRef.current) {
        sliderRef.current.value = String(controller.currentTime);
      }
      animFrameRef.current = requestAnimationFrame(update);
    };
    animFrameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [state.mode, controller]);

  const handlePlayPause = useCallback(() => {
    if (controller.mode === "playing") {
      controller.pause();
    } else {
      controller.play();
    }
  }, [controller]);

  const handleStop = useCallback(() => {
    controller.stop();
  }, [controller]);

  const handleSliderInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      isDragging.current = true;
      controller.seek(Number((e.target as HTMLInputElement).value));
    },
    [controller],
  );

  const handleSliderChange = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      controller.setSpeed(Number(e.target.value));
    },
    [controller],
  );

  const handleToggleLoop = useCallback(() => {
    controller.setLoop(!controller.loop);
  }, [controller]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      if (
        (target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.tagName === "BUTTON" ||
            target.isContentEditable ||
            Boolean(target.closest?.(".monaco-editor, [contenteditable='true'], input, textarea, select")))) ||
        (active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.tagName === "BUTTON" ||
            active.isContentEditable ||
            Boolean(active.closest?.(".monaco-editor, [contenteditable='true'], input, textarea, select"))))
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const step = (state.stopTime - state.startTime) / 100;
        controller.seek(controller.currentTime - step);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const step = (state.stopTime - state.startTime) / 100;
        controller.seek(controller.currentTime + step);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePlayPause, state.stopTime, state.startTime, controller]);

  if (!state.hasData && state.mode !== "live") return null;

  const progress =
    state.stopTime > state.startTime
      ? ((state.currentTime - state.startTime) / (state.stopTime - state.startTime)) * 100
      : 0;

  const isLive = state.mode === "live";

  return (
    <div
      className="animation-timeline"
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 12,
        background: "var(--vscode-editor-background, rgba(30, 30, 30, 0.9))",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--vscode-widget-border, rgba(255,255,255,0.1))",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        zIndex: 100,
        minWidth: 420,
        maxWidth: "90vw",
        userSelect: "none",
        color: "var(--vscode-foreground, #e6edf3)",
        fontSize: 13,
      }}
    >
      {/* Play / Pause */}
      <button
        style={btnStyle}
        onClick={handlePlayPause}
        disabled={isLive}
        title={state.mode === "playing" ? "Pause" : "Play"}
      >
        {state.mode === "playing" ? "⏸" : "▶"}
      </button>

      {/* Stop */}
      <button style={btnStyle} onClick={handleStop} disabled={state.mode === "stopped"} title="Stop">
        ⏹
      </button>

      {/* Time display */}
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          minWidth: 100,
          textAlign: "center",
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 12,
          opacity: 0.9,
        }}
      >
        {isLive ? (
          <span style={{ color: "#3fb950" }}>● LIVE</span>
        ) : (
          `${formatTime(state.currentTime)} / ${formatTime(state.stopTime)}`
        )}
      </span>

      {/* Scrubber slider + Mission Phase Bands + Operator Action Markers */}
      <div style={{ flex: 1, position: "relative", minWidth: 140 }}>
        {missionPhases && missionPhases.length > 0 && state.stopTime > state.startTime && (
          <div
            style={{
              display: "flex",
              position: "relative",
              height: 11,
              marginBottom: 4,
              borderRadius: 3,
              overflow: "hidden",
              background: "rgba(148, 163, 184, 0.14)",
            }}
          >
            {missionPhases.map((phase) => {
              const range = state.stopTime - state.startTime;
              const leftPct = Math.max(0, Math.min(100, ((phase.startTime - state.startTime) / range) * 100));
              const widthPct = Math.max(2, Math.min(100 - leftPct, ((phase.endTime - phase.startTime) / range) * 100));
              const active = state.currentTime >= phase.startTime && state.currentTime <= phase.endTime;
              return (
                <button
                  key={phase.id}
                  type="button"
                  title={`${phase.label} (${phase.startTime.toFixed(1)}s – ${phase.endTime.toFixed(1)}s)`}
                  onClick={() => controller.seek(phase.startTime + 0.01)}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: "100%",
                    border: "none",
                    borderRight: "1px solid rgba(15,23,42,0.45)",
                    background: active ? `${phase.color}88` : `${phase.color}33`,
                    color: "#f8fafc",
                    fontSize: 8,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    padding: "0 3px",
                    cursor: "pointer",
                  }}
                >
                  {phase.label}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ position: "relative" }}>
          <input
            ref={sliderRef}
            type="range"
            min={state.startTime}
            max={state.stopTime}
            step={(state.stopTime - state.startTime) / 1000 || 0.001}
            defaultValue={state.currentTime}
            onInput={handleSliderInput}
            onChange={handleSliderChange}
            disabled={isLive}
            aria-label="Timeline scrubber"
            style={{
              width: "100%",
              height: 6,
              appearance: "none",
              WebkitAppearance: "none",
              background: `linear-gradient(to right, var(--vscode-textLink-foreground, var(--ms-brand, #22d3ee)) ${progress}%, rgba(255,255,255,0.15) ${progress}%)`,
              borderRadius: 3,
              outline: "none",
              cursor: isLive ? "not-allowed" : "pointer",
              opacity: isLive ? 0.4 : 1,
            }}
          />
          {operationLog &&
            operationLog.map((ev) => {
              const range = state.stopTime - state.startTime;
              if (range <= 0) return null;
              const leftPct = Math.max(0, Math.min(100, ((ev.time - state.startTime) / range) * 100));
              const dotColor =
                ev.category === "fault" || ev.category === "breach"
                  ? "#ef4444"
                  : ev.category === "autonomy"
                    ? "#38bdf8"
                    : "#f97316";
              return (
                <button
                  key={ev.id}
                  type="button"
                  title={`${ev.time.toFixed(1)}s · [${ev.code}] ${ev.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.seek(ev.time);
                  }}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    border: "1px solid #0f172a",
                    backgroundColor: dotColor,
                    padding: 0,
                    cursor: "pointer",
                  }}
                />
              );
            })}
        </div>
      </div>

      {operationLog && operationLog.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setLogExpanded((v) => !v)}
            style={{
              ...btnStyle,
              fontSize: 10,
              fontWeight: 700,
              border: `1px solid ${logExpanded ? "#f97316" : "rgba(255,255,255,0.16)"}`,
              color: logExpanded ? "#f97316" : "inherit",
            }}
          >
            OPS ({operationLog.length})
          </button>
          {logExpanded && (
            <div
              style={{
                position: "absolute",
                bottom: 36,
                right: 0,
                width: 260,
                maxHeight: 190,
                overflowY: "auto",
                padding: 8,
                borderRadius: 8,
                background: "var(--vscode-editor-background, rgba(15, 23, 42, 0.95))",
                border: "1px solid var(--vscode-widget-border, rgba(255,255,255,0.16))",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {operationLog.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => controller.seek(ev.time)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "4px 6px",
                    borderRadius: 4,
                    border: "none",
                    background: state.currentTime >= ev.time ? "rgba(56,189,248,0.16)" : "transparent",
                    color: "inherit",
                    fontSize: 10.5,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ opacity: 0.7 }}>{formatTime(ev.time)}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.label}
                  </span>
                  <span style={{ color: "#f97316", fontWeight: 700 }}>{ev.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Speed selector */}
      <select
        value={state.playbackSpeed}
        onChange={handleSpeedChange}
        disabled={isLive}
        aria-label="Playback speed"
        style={{
          width: 60,
          height: 24,
          fontSize: 11,
          background: "var(--vscode-dropdown-background, transparent)",
          border: "1px solid var(--vscode-dropdown-border, rgba(255,255,255,0.15))",
          borderRadius: 4,
          color: "var(--vscode-dropdown-foreground, inherit)",
          outline: "none",
        }}
      >
        {SPEED_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Loop toggle */}
      <button
        style={{
          ...btnStyle,
          color: controller.loop
            ? "var(--vscode-textLink-foreground, var(--ms-brand, #22d3ee))"
            : "var(--vscode-foreground, #8b949e)",
        }}
        onClick={handleToggleLoop}
        disabled={isLive}
        title={controller.loop ? "Disable loop" : "Enable loop"}
      >
        🔁
      </button>
    </div>
  );
}
