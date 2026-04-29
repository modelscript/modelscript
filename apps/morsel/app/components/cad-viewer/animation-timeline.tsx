// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Animation timeline overlay for the CadViewer.
 *
 * Provides play/pause/stop controls, a scrubbing slider, speed selector,
 * and current-time display. Positioned as a floating bar at the bottom of
 * the 3D viewport.
 */

import { PauseIcon, PlayIcon, SquareFillIcon, SyncIcon } from "@primer/octicons-react";
import { IconButton, Select } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationController, AnimationState } from "./animation-controller";

interface AnimationTimelineProps {
  controller: AnimationController;
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

export function AnimationTimeline({ controller }: AnimationTimelineProps) {
  const [state, setState] = useState<AnimationState>(controller.state);
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
      // Don't capture shortcuts when typing in an input
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;

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
        background: "var(--color-canvas-overlay, rgba(30, 30, 30, 0.9))",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--color-border-default, rgba(255,255,255,0.1))",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        zIndex: 100,
        minWidth: 420,
        maxWidth: "90vw",
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

      {/* Scrubber slider */}
      <div style={{ flex: 1, position: "relative", minWidth: 120 }}>
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
            background: `linear-gradient(to right, var(--color-accent-fg, #58a6ff) ${progress}%, var(--color-border-default, rgba(255,255,255,0.15)) ${progress}%)`,
            borderRadius: 3,
            outline: "none",
            cursor: isLive ? "not-allowed" : "pointer",
            opacity: isLive ? 0.4 : 1,
          }}
        />
      </div>

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
