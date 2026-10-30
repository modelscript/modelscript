// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import React, { useCallback, useState } from "react";
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
  hasFloatingDock?: boolean | undefined;
  defaultExpanded?: boolean | undefined;
  fullWidth?: boolean | undefined;
}

const RibbonContainer = styled.div<{
  $dark: boolean;
  $expanded: boolean;
  $hasFloatingDock: boolean;
  $fullWidth: boolean;
}>`
  position: absolute;
  bottom: ${(props) => (props.$hasFloatingDock ? "68px" : "12px")};
  left: 12px;
  max-width: ${(props) => (props.$fullWidth ? "calc(100% - 24px)" : "calc(100% - 190px)")};
  width: ${(props) => (props.$expanded ? "auto" : "max-content")};
  z-index: 90;
  display: flex;
  flex-direction: column;
  background: ${(props) => (props.$dark ? "rgba(13, 17, 23, 0.92)" : "rgba(255, 255, 255, 0.92)")};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${(props) => (props.$dark ? "rgba(48, 54, 61, 0.85)" : "rgba(208, 215, 222, 0.85)")};
  border-radius: ${(props) => (props.$expanded ? "10px" : "999px")};
  box-shadow: 0 6px 24px rgba(0, 0, 0, ${(props) => (props.$dark ? "0.4" : "0.14")});
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  @media (max-width: 768px) {
    bottom: 12px;
    max-width: calc(100% - 24px);
  }
`;

const RibbonHeader = styled.div<{ $dark: boolean; $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: ${(props) => (props.$expanded ? "6px 12px" : "5px 10px 5px 12px")};
  cursor: pointer;
  user-select: none;
  border-bottom: ${(props) =>
    props.$expanded ? `1px solid ${props.$dark ? "rgba(48, 54, 61, 0.6)" : "rgba(208, 215, 222, 0.6)"}` : "none"};
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
  margin-left: 4px;
`;

const SlidersTrack = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
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
  min-width: 136px;
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

export const ParameterSliderRibbon: React.FC<ParameterSliderRibbonProps> = ({
  parameters,
  overrides,
  onChange,
  onReset,
  onSimulate,
  isSimulating = false,
  dark = true,
  hasFloatingDock = false,
  defaultExpanded = true,
  fullWidth = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleSliderChange = useCallback(
    (name: string, value: number) => {
      onChange(name, value);
    },
    [onChange],
  );

  if (parameters.length === 0) return null;

  const isPlaygroundRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/playground");
  const effectiveHasFloatingDock = Boolean(hasFloatingDock && !isPlaygroundRoute);

  return (
    <RibbonContainer
      $dark={dark}
      $expanded={isExpanded}
      $hasFloatingDock={effectiveHasFloatingDock}
      $fullWidth={fullWidth}
    >
      <RibbonHeader $dark={dark} $expanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span>🎛️ Parameters</span>
          <Badge $dark={dark}>{parameters.length}</Badge>
          {overrides.size > 0 && (
            <span
              style={{
                fontSize: "10px",
                color: dark ? "#22d3ee" : "#0891b2",
                marginLeft: 4,
              }}
            >
              • {overrides.size} edited
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onSimulate && (
            <button
              type="button"
              aria-live="polite"
              aria-busy={isSimulating}
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
                borderRadius: "999px",
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
          <span style={{ fontSize: "10px", opacity: 0.75 }}>{isExpanded ? "▼" : "▲"}</span>
        </div>
      </RibbonHeader>

      {isExpanded && (
        <SlidersTrack>
          {parameters.map((param) => {
            const currentVal = overrides.has(param.name) ? overrides.get(param.name)! : param.defaultValue;
            const isOverridden = overrides.has(param.name);

            // Compute slider bounds
            const base = param.defaultValue;
            let min = param.min ?? (base > 0 ? 0 : base < 0 ? base * 2 : -10);
            let max = param.max ?? (base > 0 ? base * 2.5 : base < 0 ? 0 : 10);
            if (min === max) {
              if (base === 0) {
                min = -10;
                max = 10;
              } else {
                min = base * 0.5;
                max = base * 1.5;
              }
            }
            if (min > currentVal) min = currentVal < 0 ? currentVal * 1.2 : currentVal * 0.8;
            if (max < currentVal) max = currentVal > 0 ? currentVal * 1.2 : currentVal * 0.8;

            const step =
              base === 0 && param.min === undefined && param.max === undefined ? 0.1 : (max - min) / 100 || 0.1;

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
