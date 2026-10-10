// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon, VersionsIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton, TextInput, ToggleSwitch } from "@primer/react";
import { useCallback, useRef, useState } from "react";

export interface ParameterInfo {
  name: string;
  type: "real" | "integer" | "boolean" | "enumeration";
  defaultValue: number;
  step?: number;
  unit?: string;
  enumLiterals?: { ordinal: number; label: string }[];
}

export interface SweepState {
  parameterName: string;
  start: number;
  end: number;
  steps: number;
}

interface SimulationParametersProps {
  /** Parameter metadata from the simulator. */
  parameters: ParameterInfo[];
  /** Current user overrides (sparse — only contains changed values). */
  overrides: Map<string, number>;
  /** Sweep configuration state. */
  sweepState?: SweepState | null;
  /** Called when the user edits a parameter value. */
  onChange: (name: string, value: number) => void;
  /** Called when the user resets a parameter to its default. */
  onReset: (name: string) => void;
  /** Called when the sweep mode is toggled or sweep config is changed. */
  onSweepChange?: (sweep: SweepState | null) => void;
}

// ──────────────────────────────────────────────────────────────────
// Numeric parameter row (Real or Integer)
// ──────────────────────────────────────────────────────────────────
function NumericParameterRow({
  info,
  currentValue,
  isOverridden,
  sweepState,
  onChange,
  onReset,
  onSweepChange,
}: {
  info: ParameterInfo;
  currentValue: number;
  isOverridden: boolean;
  sweepState?: SweepState | null;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
  onSweepChange?: (sweep: SweepState | null) => void;
}) {
  const [editValue, setEditValue] = useState(String(currentValue));

  // Sync local edit value when external value changes (e.g. after reset)
  const prevValueRef = useRef(currentValue);
  if (prevValueRef.current !== currentValue) {
    prevValueRef.current = currentValue;
    setEditValue(String(currentValue));
  }

  const commit = useCallback(() => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed !== currentValue) {
      onChange(info.name, parsed);
    } else {
      setEditValue(String(currentValue));
    }
  }, [editValue, currentValue, info.name, onChange]);

  const unit = info.unit ? formatUnit(info.unit) : undefined;
  const isSweeping = sweepState?.parameterName === info.name;

  const toggleSweep = useCallback(() => {
    if (isSweeping) {
      onSweepChange?.(null);
    } else {
      onSweepChange?.({ parameterName: info.name, start: currentValue, end: currentValue * 2 || 1, steps: 5 });
    }
  }, [isSweeping, info.name, currentValue, onSweepChange]);

  return (
    <div style={ROW_STYLE}>
      <ResetButton visible={isOverridden && !isSweeping} name={info.name} onReset={onReset} />
      <span style={labelStyle(isOverridden || isSweeping)} title={info.name}>
        {info.name}
      </span>
      {onSweepChange && (
        <IconButton
          icon={VersionsIcon}
          aria-label="Toggle Sweep"
          size="small"
          variant="invisible"
          onClick={toggleSweep}
          style={{
            color: isSweeping ? "var(--fgColor-accent, #0969da)" : "var(--fgColor-muted, #656d76)",
            marginRight: 4,
            padding: "0 4px",
          }}
        />
      )}
      {isSweeping && sweepState ? (
        <div style={{ display: "flex", gap: 4, width: 120 }}>
          <TextInput
            size="small"
            title="Start"
            value={String(sweepState.start)}
            onChange={(e) => onSweepChange?.({ ...sweepState, start: parseFloat(e.target.value) || 0 })}
            style={{ width: "33%", padding: "0 2px", fontSize: 11 }}
          />
          <TextInput
            size="small"
            title="End"
            value={String(sweepState.end)}
            onChange={(e) => onSweepChange?.({ ...sweepState, end: parseFloat(e.target.value) || 0 })}
            style={{ width: "33%", padding: "0 2px", fontSize: 11 }}
          />
          <TextInput
            size="small"
            title="Steps"
            value={String(sweepState.steps)}
            onChange={(e) => onSweepChange?.({ ...sweepState, steps: parseInt(e.target.value) || 2 })}
            style={{ width: "33%", padding: "0 2px", fontSize: 11 }}
          />
        </div>
      ) : (
        <TextInput
          size="small"
          value={editValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            e.stopPropagation();
            setEditValue(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          trailingVisual={
            unit
              ? () => (
                  <span style={{ fontSize: 11, color: "var(--fgColor-muted, #656d76)", whiteSpace: "nowrap" }}>
                    {unit}
                  </span>
                )
              : undefined
          }
          style={{ width: 120, height: 24, fontSize: 12 }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Boolean parameter row
// ──────────────────────────────────────────────────────────────────
function BooleanParameterRow({
  info,
  currentValue,
  isOverridden,
  onChange,
  onReset,
}: {
  info: ParameterInfo;
  currentValue: number;
  isOverridden: boolean;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
}) {
  // Use a ref-based stable callback to prevent Primer ToggleSwitch from infinite looping in useEffect
  // because the `onChange` prop passed from parent components changes every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleToggle = useCallback(
    (checked: boolean) => {
      onChangeRef.current(info.name, checked ? 1 : 0);
    },
    [info.name],
  );

  return (
    <div style={ROW_STYLE}>
      <ResetButton visible={isOverridden} name={info.name} onReset={onReset} />
      <span style={labelStyle(isOverridden)} title={info.name}>
        {info.name}
      </span>
      <ToggleSwitch
        checked={currentValue !== 0}
        onChange={handleToggle}
        size="small"
        aria-label={info.name}
        aria-labelledby=""
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Enumeration parameter row
// ──────────────────────────────────────────────────────────────────
function EnumParameterRow({
  info,
  currentValue,
  isOverridden,
  onChange,
  onReset,
}: {
  info: ParameterInfo;
  currentValue: number;
  isOverridden: boolean;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
}) {
  const literals = info.enumLiterals ?? [];
  const selectedLabel =
    literals.find((l: { ordinal: number; label: string }) => l.ordinal === currentValue)?.label ?? String(currentValue);

  return (
    <div style={ROW_STYLE}>
      <ResetButton visible={isOverridden} name={info.name} onReset={onReset} />
      <span style={labelStyle(isOverridden)} title={info.name}>
        {info.name}
      </span>
      <ActionMenu>
        <ActionMenu.Button size="small" style={{ fontSize: 12, maxWidth: 120 }}>
          {selectedLabel}
        </ActionMenu.Button>
        <ActionMenu.Overlay width="auto">
          <ActionList>
            {literals.map((lit: { ordinal: number; label: string }) => (
              <ActionList.Item
                key={lit.ordinal}
                selected={lit.ordinal === currentValue}
                onSelect={() => onChange(info.name, lit.ordinal)}
              >
                {lit.label}
              </ActionList.Item>
            ))}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────
function ResetButton({ visible, name, onReset }: { visible: boolean; name: string; onReset: (name: string) => void }) {
  if (!visible) return <div style={{ width: 24, flexShrink: 0 }} />;
  return (
    <IconButton
      icon={SyncIcon}
      aria-label={`Reset ${name} to default`}
      size="small"
      variant="invisible"
      onClick={() => onReset(name)}
      style={{ flexShrink: 0 }}
    />
  );
}

function formatUnit(unit: string): string {
  if (unit === "Ohm") return "Ω";
  return unit;
}

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 12px",
  fontSize: 13,
};

function labelStyle(isOverridden: boolean): React.CSSProperties {
  return {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: isOverridden ? 600 : 400,
    color: isOverridden ? "var(--color-accent-fg)" : "var(--color-fg-default)",
  };
}

// ──────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────
export function SimulationParameters({
  parameters,
  overrides,
  sweepState,
  onChange,
  onReset,
  onSweepChange,
}: SimulationParametersProps) {
  if (parameters.length === 0) {
    return (
      <div style={{ padding: "12px", color: "var(--color-fg-muted)", fontSize: 13 }}>No parameters available.</div>
    );
  }

  return (
    <div style={{ paddingTop: 4, paddingBottom: 4 }}>
      {parameters.map((info) => {
        const isOverridden = overrides.has(info.name);
        const currentValue = isOverridden ? (overrides.get(info.name) ?? info.defaultValue) : info.defaultValue;

        switch (info.type) {
          case "boolean":
            return (
              <BooleanParameterRow
                key={info.name}
                info={info}
                currentValue={currentValue}
                isOverridden={isOverridden}
                onChange={onChange}
                onReset={onReset}
              />
            );
          case "enumeration":
            return (
              <EnumParameterRow
                key={info.name}
                info={info}
                currentValue={currentValue}
                isOverridden={isOverridden}
                onChange={onChange}
                onReset={onReset}
              />
            );
          default:
            return (
              <NumericParameterRow
                key={info.name}
                info={info}
                currentValue={currentValue}
                isOverridden={isOverridden}
                sweepState={sweepState}
                onChange={onChange}
                onReset={onReset}
                onSweepChange={onSweepChange}
              />
            );
        }
      })}
    </div>
  );
}

export interface ExperimentOverrides {
  startTime?: number;
  stopTime?: number;
  interval?: number;
  tolerance?: number;
  solver?: string;
  numberOfIntervals?: number;
  atol?: number;
  equidistant?: boolean;
  steadyStateOnly?: boolean;
}

export function SimulationExperimentSettings({
  experiment,
  overrides,
  onChange,
  onReset,
}: {
  experiment?: {
    startTime?: number;
    stopTime?: number;
    interval?: number;
    tolerance?: number;
    solver?: string;
    numberOfIntervals?: number;
  };
  overrides: ExperimentOverrides;
  onChange: (name: keyof ExperimentOverrides, value: any) => void;
  onReset: (name: keyof ExperimentOverrides) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const defaults = {
    startTime: experiment?.startTime ?? 0,
    stopTime: experiment?.stopTime ?? 10,
    interval: experiment?.interval ?? ((experiment?.stopTime ?? 10) - (experiment?.startTime ?? 0)) / 500,
    tolerance: experiment?.tolerance ?? 1e-6,
    solver: experiment?.solver ?? "dopri5",
    numberOfIntervals: experiment?.numberOfIntervals ?? 500,
    atol: 1e-6,
    equidistant: true,
    steadyStateOnly: false,
  };

  const fields: { key: "startTime" | "stopTime" | "interval" | "tolerance"; label: string }[] = [
    { key: "startTime", label: "Start Time" },
    { key: "stopTime", label: "Stop Time" },
    { key: "interval", label: "Interval" },
    { key: "tolerance", label: "Tolerance" },
  ];

  const currentSolver = overrides.solver ?? defaults.solver;
  const isSolverOverridden = overrides.solver !== undefined && overrides.solver !== defaults.solver;

  return (
    <div style={{ paddingTop: 4, paddingBottom: 4 }}>
      {fields.map(({ key, label }) => {
        const isOverridden = overrides[key] !== undefined;
        const currentValue = isOverridden ? (overrides[key] as number) : defaults[key];

        return (
          <NumericParameterRow
            key={key}
            info={{ name: label, type: "real", defaultValue: defaults[key] } as any}
            currentValue={currentValue}
            isOverridden={isOverridden}
            onChange={(_, val) => onChange(key, val)}
            onReset={() => onReset(key)}
          />
        );
      })}

      {/* Solver Engine Selector */}
      <div style={ROW_STYLE}>
        <ResetButton visible={isSolverOverridden} name="solver" onReset={() => onReset("solver")} />
        <span style={labelStyle(isSolverOverridden)} title="Numerical Integration Solver">
          Solver
        </span>
        <select
          value={currentSolver}
          onChange={(e) => onChange("solver", e.target.value)}
          style={{
            fontSize: "12px",
            padding: "3px 6px",
            borderRadius: "6px",
            border: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-default, #ffffff)",
            color: "var(--color-fg-default, #24292f)",
            width: 140,
            cursor: "pointer",
            outline: "none",
          }}
          title="Select numerical solver algorithm"
        >
          <option value="dopri5">DOPRI5 (Adaptive 5(4))</option>
          <option value="cvode">CVODE (SUNDIALS BDF)</option>
          <option value="tsit5">TSIT5 (Adaptive 5(4))</option>
          <option value="bdf">BDF (Stiff Multi-Step)</option>
          <option value="rk4">RK4 (Fixed Step 4th)</option>
          <option value="euler">Euler (Fixed Step 1st)</option>
          <option value="rodas4p">RODAS4P (Stiff DAE)</option>
          <option value="trbdf2">TR-BDF2 (SDIRK)</option>
          <option value="auto">Auto (Adaptive)</option>
          <option value="webgpu">WebGPU (Batched)</option>
        </select>
      </div>

      {/* Advanced Settings Accordion */}
      <div style={{ padding: "6px 12px 2px 12px" }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            fontSize: "11px",
            background: "transparent",
            border: "none",
            color: "var(--color-accent-fg, #0969da)",
            cursor: "pointer",
            padding: "2px 0",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontWeight: 600,
          }}
        >
          <span>{showAdvanced ? "▾" : "▸"}</span>
          <span>Advanced Solver Options</span>
        </button>
      </div>

      {showAdvanced && (
        <div
          style={{
            background: "var(--color-canvas-subtle, rgba(0,0,0,0.02))",
            padding: "4px 0",
            borderRadius: "4px",
            margin: "2px 8px",
          }}
        >
          <NumericParameterRow
            key="numberOfIntervals"
            info={{ name: "Intervals", type: "integer", defaultValue: defaults.numberOfIntervals } as any}
            currentValue={
              overrides.numberOfIntervals !== undefined ? overrides.numberOfIntervals : defaults.numberOfIntervals
            }
            isOverridden={overrides.numberOfIntervals !== undefined}
            onChange={(_, val) => onChange("numberOfIntervals", Math.round(val))}
            onReset={() => onReset("numberOfIntervals")}
          />
          <NumericParameterRow
            key="atol"
            info={{ name: "Absolute Tol", type: "real", defaultValue: defaults.atol } as any}
            currentValue={overrides.atol !== undefined ? overrides.atol : defaults.atol}
            isOverridden={overrides.atol !== undefined}
            onChange={(_, val) => onChange("atol", val)}
            onReset={() => onReset("atol")}
          />
          <div style={ROW_STYLE}>
            <div style={{ width: 24, flexShrink: 0 }} />
            <label
              style={{
                flex: 1,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                color: "var(--color-fg-default)",
              }}
            >
              <span>Equidistant Grid</span>
              <input
                type="checkbox"
                checked={overrides.equidistant !== false}
                onChange={(e) => onChange("equidistant", e.target.checked)}
                style={{ cursor: "pointer", accentColor: "var(--color-accent-emphasis, #0969da)" }}
              />
            </label>
          </div>
          <div style={ROW_STYLE}>
            <div style={{ width: 24, flexShrink: 0 }} />
            <label
              style={{
                flex: 1,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                color: "var(--color-fg-default)",
              }}
            >
              <span>Steady-State Equilibrium</span>
              <input
                type="checkbox"
                checked={!!overrides.steadyStateOnly}
                onChange={(e) => onChange("steadyStateOnly", e.target.checked)}
                style={{ cursor: "pointer", accentColor: "var(--color-accent-emphasis, #0969da)" }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
