// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ParameterInfo } from "@modelscript/core";
import { SyncIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton, TextInput, ToggleSwitch } from "@primer/react";
import { useCallback, useRef, useState } from "react";

interface SimulationParametersProps {
  /** Parameter metadata from the simulator. */
  parameters: ParameterInfo[];
  /** Current user overrides (sparse — only contains changed values). */
  overrides: Map<string, number>;
  /** Called when the user edits a parameter value. */
  onChange: (name: string, value: number) => void;
  /** Called when the user resets a parameter to its default. */
  onReset: (name: string) => void;
}

// ──────────────────────────────────────────────────────────────────
// Numeric parameter row (Real or Integer)
// ──────────────────────────────────────────────────────────────────
function NumericParameterRow({
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

  return (
    <div style={ROW_STYLE}>
      <ResetButton visible={isOverridden} name={info.name} onReset={onReset} />
      <span style={labelStyle(isOverridden)} title={info.name}>
        {info.name}
      </span>
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
  return (
    <div style={ROW_STYLE}>
      <ResetButton visible={isOverridden} name={info.name} onReset={onReset} />
      <span style={labelStyle(isOverridden)} title={info.name}>
        {info.name}
      </span>
      <ToggleSwitch
        checked={currentValue !== 0}
        onChange={() => onChange(info.name, currentValue !== 0 ? 0 : 1)}
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
export function SimulationParameters({ parameters, overrides, onChange, onReset }: SimulationParametersProps) {
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
                onChange={onChange}
                onReset={onReset}
              />
            );
        }
      })}
    </div>
  );
}
