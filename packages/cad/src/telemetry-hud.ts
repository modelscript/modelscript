// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Headless Field-Simulator Telemetry HUD & Operation Log Schema.
 *
 * Framework-agnostic declarative specification and zero-churn sampler shared by
 * both Non-VR DOM HUD overlays (`SimulatorTelemetryHud.tsx`) and stereo-safe
 * VR Canvas2D curved tablets (`FloatingToolWings.tsx`).
 */

import type { AnimationController } from "./animation-controller.js";

/** Operational status pill shown in the top telemetry bar. */
export interface StatusBadgeRule {
  readonly minValue: number;
  readonly label: string;
  readonly color: string;
}

/** Colored mission phase segment displayed along the Operation Log timeline track. */
export interface MissionPhaseBand {
  readonly id: string;
  readonly label: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly color: string;
}

/** Discrete operator action, autonomy transition, fault, or verification breach event. */
export interface OperationLogEvent {
  readonly id: string;
  readonly time: number;
  readonly code: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly category: "operator" | "autonomy" | "fault" | "breach";
}

export type TelemetryWidgetSpec =
  | {
      readonly kind: "sparkline";
      readonly id: string;
      readonly code: string;
      readonly label: string;
      readonly unit: string;
      readonly channel: string;
      readonly min: number;
      readonly max: number;
      readonly accentColor: string;
      readonly statusIdleLabel?: string | undefined;
      readonly statusActiveLabel?: string | undefined;
      readonly activeThreshold?: number | undefined;
      readonly windowSec?: number | undefined;
      readonly sampleCount?: number | undefined;
    }
  | {
      readonly kind: "segmented-bar";
      readonly id: string;
      readonly code: string;
      readonly label: string;
      readonly unit: string;
      readonly channel: string;
      readonly min: number;
      readonly max: number;
      readonly segments?: number | undefined;
      readonly accentColor: string;
      readonly warnThreshold?: number | undefined;
    }
  | {
      readonly kind: "bar-array";
      readonly id: string;
      readonly code: string;
      readonly label: string;
      readonly badge?: string | undefined;
      readonly channels: readonly {
        readonly id: string;
        readonly label: string;
        readonly channel: string;
        readonly attachedChannel?: string | undefined;
      }[];
      readonly min: number;
      readonly max: number;
      readonly unit?: string | undefined;
      readonly accentColor: string;
    }
  | {
      readonly kind: "horizon";
      readonly id: string;
      readonly code: string;
      readonly label: string;
      readonly depthChannel: string;
      readonly pitchChannel: string;
      readonly rollChannel: string;
      readonly holdChannel?: string | undefined;
      readonly depthUnit?: string | undefined;
    };

/** Declarative specification for a model's live Field Simulator Telemetry HUD & Operation Log. */
export interface SimulatorHudSpec {
  readonly modelCode: string;
  readonly modelSubtitle: string;
  readonly simId: string;
  readonly durationSec: number;
  readonly loadGauge: {
    readonly label: string;
    readonly channel: string;
    readonly ticks: readonly string[];
  };
  readonly statusChannel: string;
  readonly statusRules: readonly StatusBadgeRule[];
  readonly leftWidgets: readonly TelemetryWidgetSpec[];
  readonly rightWidgets: readonly TelemetryWidgetSpec[];
  readonly missionPhases: readonly MissionPhaseBand[];
  readonly operationLog: readonly OperationLogEvent[];
}

/** Optional analytical or live channel lookup function (fallback when no timeseries is loaded). */
export type TelemetryChannelProvider = (channel: string, time: number) => number | null;

export interface SampledSparklineWidget {
  readonly kind: "sparkline";
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly accentColor: string;
  readonly statusLabel: string;
  readonly samples: readonly number[];
}

export interface SampledSegmentedBarWidget {
  readonly kind: "segmented-bar";
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly normalized: number;
  readonly segments: number;
  readonly accentColor: string;
  readonly isWarning: boolean;
}

export interface SampledBarArrayWidget {
  readonly kind: "bar-array";
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly badge?: string | undefined;
  readonly accentColor: string;
  readonly bars: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly normalized: number;
    readonly attached: boolean;
  }[];
}

export interface SampledHorizonWidget {
  readonly kind: "horizon";
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly depth: number;
  readonly depthUnit: string;
  readonly pitchDeg: number;
  readonly rollDeg: number;
  readonly holdActive: boolean;
}

export type SampledTelemetryWidget =
  SampledSparklineWidget | SampledSegmentedBarWidget | SampledBarArrayWidget | SampledHorizonWidget;

export interface SampledTelemetryFrame {
  readonly time: number;
  readonly durationSec: number;
  readonly modelCode: string;
  readonly modelSubtitle: string;
  readonly simId: string;
  readonly loadLabel: string;
  readonly loadPercent: number;
  readonly loadTicks: readonly string[];
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly activePhase: MissionPhaseBand | null;
  readonly leftWidgets: readonly SampledTelemetryWidget[];
  readonly rightWidgets: readonly SampledTelemetryWidget[];
  readonly missionPhases: readonly MissionPhaseBand[];
  readonly operationLog: readonly OperationLogEvent[];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function readChannelAt(
  channel: string,
  time: number,
  controller?: Pick<AnimationController, "getVariableValue"> | null,
  provider?: TelemetryChannelProvider | null,
): number {
  if (provider) {
    const provided = provider(channel, time);
    if (provided !== null && Number.isFinite(provided)) return provided;
  }
  if (controller) {
    const val = controller.getVariableValue(channel);
    if (val !== null && Number.isFinite(val)) return val;
  }
  return 0;
}

/** Finds the active mission phase band enclosing `time`. */
export function resolveActiveMissionPhase(phases: readonly MissionPhaseBand[], time: number): MissionPhaseBand | null {
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    if (time >= p.startTime && time <= p.endTime) {
      return p;
    }
  }
  return phases[phases.length - 1] ?? null;
}

function sampleWidget(
  widget: TelemetryWidgetSpec,
  time: number,
  controller?: Pick<AnimationController, "getVariableValue"> | null,
  provider?: TelemetryChannelProvider | null,
): SampledTelemetryWidget {
  switch (widget.kind) {
    case "sparkline": {
      const value = readChannelAt(widget.channel, time, controller, provider);
      const count = Math.max(6, Math.min(64, widget.sampleCount ?? 24));
      const windowSec = Math.max(0.5, widget.windowSec ?? 6);
      const samples: number[] = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        const sampleT = Math.max(0, time - windowSec * (1 - i / (count - 1)));
        samples[i] = readChannelAt(widget.channel, sampleT, controller, provider);
      }
      const threshold = widget.activeThreshold ?? widget.min + (widget.max - widget.min) * 0.15;
      const statusLabel =
        value >= threshold ? (widget.statusActiveLabel ?? "ACTIVE") : (widget.statusIdleLabel ?? "IDLE");
      return {
        kind: "sparkline",
        id: widget.id,
        code: widget.code,
        label: widget.label,
        unit: widget.unit,
        value,
        min: widget.min,
        max: widget.max,
        accentColor: widget.accentColor,
        statusLabel,
        samples,
      };
    }
    case "segmented-bar": {
      const value = readChannelAt(widget.channel, time, controller, provider);
      const span = Math.max(1e-6, widget.max - widget.min);
      return {
        kind: "segmented-bar",
        id: widget.id,
        code: widget.code,
        label: widget.label,
        unit: widget.unit,
        value,
        normalized: clamp01((value - widget.min) / span),
        segments: Math.max(4, Math.min(20, widget.segments ?? 10)),
        accentColor: widget.accentColor,
        isWarning: widget.warnThreshold !== undefined ? value >= widget.warnThreshold : false,
      };
    }
    case "bar-array": {
      const span = Math.max(1e-6, widget.max - widget.min);
      const bars = widget.channels.map((ch) => {
        const value = readChannelAt(ch.channel, time, controller, provider);
        const attached = ch.attachedChannel
          ? readChannelAt(ch.attachedChannel, time, controller, provider) >= 0.5
          : true;
        return {
          id: ch.id,
          label: ch.label,
          value,
          normalized: clamp01((value - widget.min) / span),
          attached,
        };
      });
      return {
        kind: "bar-array",
        id: widget.id,
        code: widget.code,
        label: widget.label,
        badge: widget.badge,
        accentColor: widget.accentColor,
        bars,
      };
    }
    case "horizon": {
      const depth = readChannelAt(widget.depthChannel, time, controller, provider);
      const pitchDeg = readChannelAt(widget.pitchChannel, time, controller, provider);
      const rollDeg = readChannelAt(widget.rollChannel, time, controller, provider);
      const holdActive = widget.holdChannel
        ? readChannelAt(widget.holdChannel, time, controller, provider) >= 0.5
        : false;
      return {
        kind: "horizon",
        id: widget.id,
        code: widget.code,
        label: widget.label,
        depth,
        depthUnit: widget.depthUnit ?? "m",
        pitchDeg,
        rollDeg,
        holdActive,
      };
    }
  }
}

/**
 * Evaluates a complete telemetry HUD snapshot at `time` from either a live/replaying
 * {@link AnimationController} or an analytical {@link TelemetryChannelProvider}.
 */
export function sampleTelemetryFrame(
  spec: SimulatorHudSpec,
  time: number,
  controller?: Pick<AnimationController, "getVariableValue"> | null,
  provider?: TelemetryChannelProvider | null,
): SampledTelemetryFrame {
  const loadPercent = Math.round(
    clamp01(readChannelAt(spec.loadGauge.channel, time, controller, provider) / 100) * 100,
  );
  const statusVal = readChannelAt(spec.statusChannel, time, controller, provider);
  let statusLabel = spec.statusRules[0]?.label ?? "READY";
  let statusColor = spec.statusRules[0]?.color ?? "#22c55e";
  for (let i = 0; i < spec.statusRules.length; i++) {
    const rule = spec.statusRules[i]!;
    if (statusVal >= rule.minValue) {
      statusLabel = rule.label;
      statusColor = rule.color;
    }
  }

  return {
    time,
    durationSec: spec.durationSec,
    modelCode: spec.modelCode,
    modelSubtitle: spec.modelSubtitle,
    simId: spec.simId,
    loadLabel: spec.loadGauge.label,
    loadPercent,
    loadTicks: spec.loadGauge.ticks,
    statusLabel,
    statusColor,
    activePhase: resolveActiveMissionPhase(spec.missionPhases, time),
    leftWidgets: spec.leftWidgets.map((w) => sampleWidget(w, time, controller, provider)),
    rightWidgets: spec.rightWidgets.map((w) => sampleWidget(w, time, controller, provider)),
    missionPhases: spec.missionPhases,
    operationLog: spec.operationLog,
  };
}
