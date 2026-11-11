// SPDX-License-Identifier: AGPL-3.0-or-later

import { GearIcon, SearchIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import { IconButton, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import styledImport from "styled-components";
import type { ExperimentConfig, SimulationParamItem } from "../../hooks/useClassSimulation";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

/* ───────────────────────── Shared primitives ───────────────────────── */

const Panel = styled.section`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
`;

const PanelTitle = styled.h3`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
`;

const CountBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  letter-spacing: 0;
  color: var(--color-text-muted);
  background: var(--color-border-muted, rgba(127, 127, 127, 0.15));
`;

const controlBase = `
  font-size: 12px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-canvas-default, #1e293b);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    border-color: var(--color-text-muted);
  }
  &:focus-visible {
    border-color: var(--ms-brand, #06b6d4);
    box-shadow: 0 0 0 3px var(--ms-brand-soft, rgba(6, 182, 212, 0.18));
  }
`;

const SelectInput = styled.select`
  ${controlBase}
  cursor: pointer;
  min-width: 0;
`;

const NumberInput = styled.input`
  ${controlBase}
  width: 88px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
`;

/* ───────────────────────── Experiment bar ───────────────────────── */

const ExperimentGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px 20px;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  > span {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted);
  }
  > ${SelectInput}, > ${NumberInput} {
    width: 100%;
    text-align: left;
  }
`;

export interface SimulationExperimentBarProps {
  experimentConfig: ExperimentConfig;
  onExperimentConfigChange: (config: ExperimentConfig) => void;
}

export const SimulationExperimentBar: React.FC<SimulationExperimentBarProps> = ({
  experimentConfig,
  onExperimentConfigChange,
}) => (
  <Panel aria-label="Solver settings">
    <PanelHeader>
      <PanelTitle>
        <GearIcon size={13} />
        Solver settings
      </PanelTitle>
    </PanelHeader>
    <ExperimentGrid>
      <Field>
        <span>Stop time (s)</span>
        <NumberInput
          type="number"
          step="any"
          value={experimentConfig.stopTime}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (!isNaN(val) && val > 0) {
              onExperimentConfigChange({ ...experimentConfig, stopTime: val });
            }
          }}
        />
      </Field>

      <Field>
        <span>Output points</span>
        <SelectInput
          value={experimentConfig.numberOfIntervals}
          onChange={(e) => onExperimentConfigChange({ ...experimentConfig, numberOfIntervals: Number(e.target.value) })}
        >
          <option value="100">100</option>
          <option value="250">250</option>
          <option value="500">500</option>
          <option value="1000">1,000</option>
          <option value="2500">2,500</option>
        </SelectInput>
      </Field>

      <Field>
        <span>Solver</span>
        <SelectInput
          value={experimentConfig.solver}
          onChange={(e) => onExperimentConfigChange({ ...experimentConfig, solver: e.target.value as any })}
        >
          <option value="dopri5">DOPRI5 (adaptive)</option>
          <option value="rk4">RK4</option>
          <option value="cvode">CVODE (stiff)</option>
          <option value="euler">Euler</option>
        </SelectInput>
      </Field>
    </ExperimentGrid>
  </Panel>
);

/* ───────────────────────── Parameters panel ───────────────────────── */

const SliderTrack = styled.input`
  flex: 1;
  min-width: 0;
  height: 4px;
  accent-color: var(--ms-brand, #06b6d4);
  cursor: pointer;
  margin: 0;
`;

const ParamGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  max-height: 440px;
  overflow-y: auto;
  padding: 2px;
`;

const ParamCard = styled.div<{ $modified: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  min-width: 0;
  background: ${({ $modified }) =>
    $modified ? "var(--ms-brand-soft, rgba(6, 182, 212, 0.08))" : "var(--color-canvas-default, transparent)"};
  border: 1px solid
    ${({ $modified }) => ($modified ? "var(--ms-brand, #06b6d4)" : "var(--color-border-muted, rgba(127,127,127,0.2))")};
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:hover {
    border-color: ${({ $modified }) => ($modified ? "var(--ms-brand, #06b6d4)" : "var(--color-text-muted)")};
  }
`;

const ParamTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ParamName = styled.span`
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const UnitTag = styled.span`
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 4px;
  color: var(--color-text-muted);
  background: var(--color-border-muted, rgba(127, 127, 127, 0.15));
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

const AutoRun = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
  color: var(--color-text-muted);
  user-select: none;
`;

export interface SimulationParametersPanelProps {
  parameters: SimulationParamItem[];
  parameterOverrides: Map<string, number>;
  onParameterChange: (name: string, value: number) => void;
  onResetParameter: (name: string) => void;
  autoRunOnScrub: boolean;
  onToggleAutoRunOnScrub: (v: boolean) => void;
}

export const SimulationParametersPanel: React.FC<SimulationParametersPanelProps> = ({
  parameters,
  parameterOverrides,
  onParameterChange,
  onResetParameter,
  autoRunOnScrub,
  onToggleAutoRunOnScrub,
}) => {
  const [paramSearch, setParamSearch] = useState("");

  const filteredParams = useMemo(() => {
    const q = paramSearch.trim().toLowerCase();
    if (!q) return parameters;
    return parameters.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.unit && p.unit.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [parameters, paramSearch]);

  if (parameters.length === 0) return null;

  return (
    <Panel aria-label="Model parameters">
      <PanelHeader>
        <PanelTitle>
          Parameters
          <CountBadge>{parameters.length}</CountBadge>
        </PanelTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {parameters.length > 5 && (
            <TextInput
              leadingVisual={SearchIcon}
              trailingAction={
                paramSearch ? (
                  <TextInput.Action onClick={() => setParamSearch("")} icon={XIcon} aria-label="Clear filter" />
                ) : undefined
              }
              placeholder="Search parameters…"
              value={paramSearch}
              onChange={(e) => setParamSearch(e.target.value)}
              size="small"
              style={{ minWidth: 220 }}
            />
          )}
          <AutoRun>
            <input
              type="checkbox"
              checked={autoRunOnScrub}
              onChange={(e) => onToggleAutoRunOnScrub(e.target.checked)}
            />
            Auto-run on change
          </AutoRun>
        </div>
      </PanelHeader>

      <ParamGrid>
        {filteredParams.map((p) => {
          const isModified = parameterOverrides.has(p.name);
          const minVal = p.min !== undefined ? p.min : p.defaultValue > 0 ? 0 : p.defaultValue * 3;
          const maxVal =
            p.max !== undefined ? p.max : p.defaultValue > 0 ? p.defaultValue * 3 : p.defaultValue < 0 ? 0 : 10;
          const stepVal = maxVal !== minVal ? Math.abs((maxVal - minVal) / 100) : 0.01;

          return (
            <ParamCard key={p.name} $modified={isModified}>
              <ParamTop>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <ParamName title={p.name}>{p.name}</ParamName>
                  {p.unit && <UnitTag>{p.unit}</UnitTag>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <NumberInput
                    type="number"
                    step="any"
                    value={p.currentValue}
                    style={{ width: 84, height: 26 }}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!isNaN(val)) onParameterChange(p.name, val);
                    }}
                  />
                  <IconButton
                    icon={SyncIcon}
                    size="small"
                    variant="invisible"
                    aria-label={`Reset ${p.name} to default (${p.defaultValue})`}
                    title={`Reset to default (${p.defaultValue})`}
                    onClick={() => onResetParameter(p.name)}
                    style={{
                      color: "var(--ms-brand, #06b6d4)",
                      visibility: isModified ? "visible" : "hidden",
                    }}
                  />
                </div>
              </ParamTop>

              <SliderRow>
                <span>{Number(minVal.toFixed(2))}</span>
                <SliderTrack
                  type="range"
                  min={minVal}
                  max={maxVal}
                  step={stepVal}
                  value={p.currentValue}
                  onChange={(e) => onParameterChange(p.name, Number(e.target.value))}
                />
                <span>{Number(maxVal.toFixed(2))}</span>
              </SliderRow>

              {p.description && (
                <Text
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                  title={p.description}
                >
                  {p.description}
                </Text>
              )}
            </ParamCard>
          );
        })}
      </ParamGrid>
    </Panel>
  );
};
