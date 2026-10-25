// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import type { ParameterInfo } from "./SimulationParameters";

export interface ParameterRibbonItem extends ParameterInfo {
  min?: number | undefined;
  max?: number | undefined;
}

interface ParameterSliderRibbonProps {
  parameters: ParameterRibbonItem[];
  overrides: Map<string, number>;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
  onSimulate?: (() => void) | undefined;
  isSimulating?: boolean | undefined;
  dark?: boolean | undefined;
}

const RibbonContainer = styled.div<{ $dark: boolean; $expanded: boolean }>`
  position: absolute;
  bottom: 12px;
  left: 12px;
  max-width: calc(100% - 190px);
  z-index: 90;
  display: flex;
  flex-direction: column;
  background: ${(props) => (props.$dark ? "rgba(13, 17, 23, 0.92)" : "rgba(255, 255, 255, 0.92)")};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${(props) => (props.$dark ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.8)")};
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, ${(props) => (props.$dark ? "0.4" : "0.15")});
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
`;

const RibbonHeader = styled.div<{ $dark: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid ${(props) => (props.$dark ? "rgba(48, 54, 61, 0.6)" : "rgba(208, 215, 222, 0.6)")};
  background: ${(props) => (props.$dark ? "rgba(22, 27, 34, 0.6)" : "rgba(246, 248, 250, 0.6)")};
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  color: ${(props) => (props.$dark ? "#f0f6fc" : "#1f2328")};
`;

const Badge = styled.span<{ $dark: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => (props.$dark ? "rgba(56, 139, 253, 0.2)" : "rgba(9, 105, 218, 0.15)")};
  color: ${(props) => (props.$dark ? "#58a6ff" : "#0969da")};
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  margin-left: 6px;
`;

const SlidersTrack = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(139, 148, 158, 0.3);
    border-radius: 4px;
  }
`;

const SliderCard = styled.div<{ $dark: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: ${(props) => (props.$dark ? "rgba(33, 38, 45, 0.7)" : "rgba(246, 248, 250, 0.7)")};
  border: 1px solid ${(props) => (props.$dark ? "rgba(48, 54, 61, 0.5)" : "rgba(208, 215, 222, 0.5)")};
`;

const CardTop = styled.div<{ $dark: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  color: ${(props) => (props.$dark ? "#f0f6fc" : "#1f2328")};
`;

const ValueInput = styled.input<{ $dark: boolean }>`
  width: 54px;
  background: ${(props) => (props.$dark ? "#0d1117" : "#ffffff")};
  border: 1px solid ${(props) => (props.$dark ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.8)")};
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: ${(props) => (props.$dark ? "#f0f6fc" : "#1f2328")};
  text-align: right;

  &:focus {
    outline: none;
    border-color: #06b6d4;
  }
`;

const RangeInput = styled.input`
  width: 100%;
  height: 4px;
  border-radius: 2px;
  accent-color: #06b6d4;
  cursor: pointer;
  margin: 6px 0 2px 0;
`;

const ResetButton = styled.button<{ $dark: boolean }>`
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: ${(props) => (props.$dark ? "#8b949e" : "#656d76")};
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s ease;

  &:hover {
    color: #f85149;
    background: ${(props) => (props.$dark ? "rgba(248, 81, 73, 0.15)" : "rgba(207, 34, 46, 0.1)")};
  }
`;

/**
 * Extracts top-level parameters from Modelica / DSL code.
 */
export function extractParametersFromCode(code: string): ParameterRibbonItem[] {
  const items: ParameterRibbonItem[] = [];
  if (!code) return items;

  // Strip single-line and multi-line comments to avoid commented-out false positives
  const cleanCode = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const regex = /parameter\s+(?:Real|Integer|Boolean|[A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleanCode)) !== null) {
    const name = match[1];
    const rest = match[2]?.trim();
    if (!name || !rest) continue;

    // Parse numeric value
    const numMatch = rest.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!numMatch) continue;

    const defaultVal = Number(numMatch[0]);
    if (isNaN(defaultVal)) continue;

    // Check for min/max annotation
    let min: number | undefined;
    let max: number | undefined;
    const minMatch = rest.match(/min\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    const maxMatch = rest.match(/max\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (minMatch && minMatch[1]) min = Number(minMatch[1]);
    if (maxMatch && maxMatch[1]) max = Number(maxMatch[1]);

    // Check for unit
    let unit: string | undefined;
    const unitMatch = rest.match(/unit\s*=\s*"([^"]+)"/);
    if (unitMatch && unitMatch[1]) unit = unitMatch[1];

    items.push({
      name,
      type: "real",
      defaultValue: defaultVal,
      min,
      max,
      unit,
    });
  }

  return items;
}

export const ParameterSliderRibbon: React.FC<ParameterSliderRibbonProps> = ({
  parameters,
  overrides,
  onChange,
  onReset,
  onSimulate,
  isSimulating = false,
  dark = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleSliderChange = useCallback(
    (name: string, value: number) => {
      onChange(name, value);

      // Auto-trigger simulation with 250ms debounce
      if (onSimulate) {
        const existingTimer = debounceTimers.current.get(name);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          onSimulate();
        }, 250);
        debounceTimers.current.set(name, timer);
      }
    },
    [onChange, onSimulate],
  );

  useEffect(() => {
    return () => {
      debounceTimers.current.forEach((t) => clearTimeout(t));
      debounceTimers.current.clear();
    };
  }, []);

  if (parameters.length === 0) return null;

  return (
    <RibbonContainer $dark={dark} $expanded={isExpanded}>
      <RibbonHeader $dark={dark} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>🎛️ Parameters</span>
          <Badge $dark={dark}>{parameters.length}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onSimulate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSimulate();
              }}
              disabled={isSimulating}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "#0969da",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
                opacity: isSimulating ? 0.6 : 1,
              }}
            >
              {isSimulating ? <SyncIcon className="spin" size={10} /> : <PlayIcon size={10} />}
              <span>{isSimulating ? "Simulating…" : "Run"}</span>
            </button>
          )}
          <span>{isExpanded ? "▼" : "▲"}</span>
        </div>
      </RibbonHeader>

      {isExpanded && (
        <SlidersTrack>
          {parameters.map((param) => {
            const currentVal = overrides.has(param.name) ? overrides.get(param.name)! : param.defaultValue;
            const isOverridden = overrides.has(param.name);

            // Compute slider bounds
            let min = param.min ?? (param.defaultValue > 0 ? 0 : param.defaultValue * 2);
            let max = param.max ?? (param.defaultValue > 0 ? param.defaultValue * 2.5 : 0);
            if (min === max) {
              min = param.defaultValue * 0.5;
              max = param.defaultValue * 1.5;
            }
            if (min > currentVal) min = currentVal * 0.8;
            if (max < currentVal) max = currentVal * 1.2;

            const step = (max - min) / 100;

            return (
              <SliderCard key={param.name} $dark={dark}>
                <CardTop $dark={dark}>
                  <span title={param.name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {param.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <ValueInput
                      $dark={dark}
                      type="number"
                      step={step}
                      value={currentVal}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) handleSliderChange(param.name, v);
                      }}
                    />
                    {param.unit && (
                      <span style={{ fontSize: "10px", color: dark ? "#8b949e" : "#656d76" }}>{param.unit}</span>
                    )}
                    {isOverridden && (
                      <ResetButton
                        $dark={dark}
                        type="button"
                        onClick={() => onReset(param.name)}
                        title="Reset to default"
                      >
                        <XIcon size={10} />
                      </ResetButton>
                    )}
                  </div>
                </CardTop>
                <RangeInput
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={currentVal}
                  onChange={(e) => handleSliderChange(param.name, parseFloat(e.target.value))}
                />
              </SliderCard>
            );
          })}
        </SlidersTrack>
      )}
    </RibbonContainer>
  );
};

export default ParameterSliderRibbon;
