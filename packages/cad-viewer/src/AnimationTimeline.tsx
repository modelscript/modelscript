// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Animation timeline overlay for the CadViewer.
 *
 * Provides play/pause/stop controls, a scrubbing slider, speed selector,
 * and current-time display. Positioned as a floating bar at the bottom of
 * the 3D viewport.
 */

import type { MissionPhaseBand, OperationLogEvent } from "@modelscript/cad";
import { PauseIcon, PlayIcon, SquareFillIcon, SyncIcon } from "@primer/octicons-react";
import { IconButton, Select } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationController, AnimationState } from "./animation-controller";

export interface BreachMarker {
  time: number;
  label: string;
  contractId?: string | undefined;
}

interface AnimationTimelineProps {
  controller: AnimationController;
  breachMarkers?: BreachMarker[] | undefined;
  missionPhases?: readonly MissionPhaseBand[] | undefined;
  operationLog?: readonly OperationLogEvent[] | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
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

export function AnimationTimeline({
  controller,
  breachMarkers,
  missionPhases,
  operationLog,
  fitInsets,
}: AnimationTimelineProps) {
  const [state, setState] = useState<AnimationState>(controller.state);
  const [logExpanded, setLogExpanded] = useState(false);
  const animFrameRef = useRef<number>(0);
  const sliderRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);

  // Subscribe to controller state changes
  useEffect(() => {
    return controller.onStateChange(setState);
  }, [controller]);

  // High-frequency slider update during playback (via rAF, not React state)
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
      if (
        !target ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON" ||
        target.isContentEditable ||
        Boolean(target.closest?.(".monaco-editor, [contenteditable='true'], input, textarea, select")) ||
        Boolean(
          (document.activeElement as HTMLElement)?.closest?.(
            ".monaco-editor, [contenteditable='true'], input, textarea, select",
          ),
        )
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
        bottom: fitInsets ? Math.max(72, fitInsets.bottom + 16) : 72,
        left: fitInsets ? `calc(50% + ${(fitInsets.left - fitInsets.right) / 2}px)` : "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        boxSizing: "border-box",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 12,
        background: "var(--color-canvas-overlay, rgba(30, 30, 30, 0.9))",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--color-border-default, rgba(255,255,255,0.1))",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        zIndex: 100,
        minWidth: fitInsets
          ? `min(420px, calc(100% - ${fitInsets.left + fitInsets.right + 24}px))`
          : "min(420px, calc(100% - 24px))",
        maxWidth: fitInsets ? `calc(100% - ${fitInsets.left + fitInsets.right + 24}px)` : "calc(100% - 24px)",
        userSelect: "none",
        color: "var(--color-fg-default, #e6edf3)",
        fontSize: 13,
      }}
    >
      {/* Play / Pause */}
      <IconButton
        icon={state.mode === "playing" ? PauseIcon : PlayIcon}
        aria-label={state.mode === "playing" ? "Pause" : "Play"}
        size="small"
        variant="invisible"
        onClick={handlePlayPause}
        disabled={isLive}
      />

      {/* Stop */}
      <IconButton
        icon={SquareFillIcon}
        aria-label="Stop"
        size="small"
        variant="invisible"
        onClick={handleStop}
        disabled={state.mode === "stopped"}
      />

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

      {/* Scrubber slider + Mission Phase Bands + Operator Action / Breach Markers */}
      <div style={{ flex: 1, position: "relative", minWidth: 140 }}>
        {missionPhases && missionPhases.length > 0 && state.stopTime > state.startTime && (
          <div
            data-testid="timeline-mission-phases"
            style={{
              display: "flex",
              position: "relative",
              height: 12,
              marginBottom: 4,
              borderRadius: 3,
              overflow: "hidden",
              background: "rgba(148, 163, 184, 0.12)",
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
                    borderRight: "1px solid rgba(15, 23, 42, 0.4)",
                    background: active ? `${phase.color}88` : `${phase.color}33`,
                    color: "#f8fafc",
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    padding: "0 4px",
                    cursor: "pointer",
                    lineHeight: "12px",
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
              background: `linear-gradient(to right, var(--fgColor-accent, var(--ms-brand)) ${progress}%, var(--borderColor-default, rgba(255,255,255,0.15)) ${progress}%)`,
              borderRadius: 3,
              outline: "none",
              cursor: isLive ? "not-allowed" : "pointer",
              opacity: isLive ? 0.4 : 1,
            }}
          />

          {/* Operator action / autonomy keyframe markers */}
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
                    zIndex: 4,
                  }}
                />
              );
            })}

          {/* Verification breach indicators on timeline */}
          {breachMarkers &&
            breachMarkers.map((b) => {
              const range = state.stopTime - state.startTime;
              if (range <= 0) return null;
              const leftPct = Math.max(0, Math.min(100, ((b.time - state.startTime) / range) * 100));
              return (
                <div
                  key={`${b.time}_${b.contractId ?? ""}`}
                  title={`Violation at ${b.time.toFixed(2)}s: ${b.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    controller.seek(b.time);
                  }}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 10,
                    height: 14,
                    cursor: "pointer",
                    zIndex: 5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: 3,
                      height: 10,
                      backgroundColor: "#ef4444",
                      borderRadius: 2,
                      boxShadow: "0 0 6px rgba(239, 68, 68, 0.9)",
                    }}
                  />
                </div>
              );
            })}
        </div>
      </div>

      {/* Expandable Operation Log trigger */}
      {operationLog && operationLog.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setLogExpanded((v) => !v)}
            style={{
              height: 28,
              padding: "0 8px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
              background: logExpanded ? "rgba(249, 115, 22, 0.22)" : "transparent",
              border: `1px solid ${logExpanded ? "#f97316" : "var(--color-border-default, rgba(255,255,255,0.15))"}`,
              borderRadius: 6,
              color: logExpanded ? "#f97316" : "var(--color-fg-default)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            OPS ({operationLog.length})
          </button>

          {logExpanded && (
            <div
              data-testid="operation-log-drawer"
              style={{
                position: "absolute",
                bottom: 38,
                right: 0,
                width: 280,
                maxHeight: 200,
                overflowY: "auto",
                padding: 8,
                borderRadius: 8,
                border: "1px solid var(--borderColor-default, rgba(255,255,255,0.18))",
                background: "var(--bgColor-default, rgba(13, 17, 23, 0.94))",
                backdropFilter: "blur(10px)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.65, padding: "0 4px" }}>
                OPERATION LOG · CLICK TO SEEK
              </div>
              {operationLog.map((ev) => {
                const isPast = state.currentTime >= ev.time;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => controller.seek(ev.time)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "4px 6px",
                      borderRadius: 5,
                      border: "none",
                      background: isPast ? "rgba(56, 189, 248, 0.14)" : "transparent",
                      color: "var(--color-fg-default, #f8fafc)",
                      fontSize: 10.5,
                      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>{formatTime(ev.time)}</span>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ev.label}
                    </span>
                    <span style={{ fontSize: 9, color: "#f97316", fontWeight: 700 }}>{ev.code}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Speed selector */}
      <Select
        value={state.playbackSpeed}
        onChange={handleSpeedChange}
        disabled={isLive}
        aria-label="Playback speed"
        style={{
          width: 65,
          height: 28,
          fontSize: 12,
          background: "transparent",
          border: "1px solid var(--color-border-default, rgba(255,255,255,0.15))",
          borderRadius: 6,
          color: "var(--color-fg-default)",
        }}
      >
        {SPEED_OPTIONS.map((opt) => (
          <Select.Option key={opt.value} value={String(opt.value)}>
            {opt.label}
          </Select.Option>
        ))}
      </Select>

      {/* Loop toggle */}
      <IconButton
        icon={SyncIcon}
        aria-label={controller.loop ? "Disable loop" : "Enable loop"}
        size="small"
        variant="invisible"
        onClick={handleToggleLoop}
        disabled={isLive}
        style={{
          color: controller.loop ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
        }}
      />
    </div>
  );
}
