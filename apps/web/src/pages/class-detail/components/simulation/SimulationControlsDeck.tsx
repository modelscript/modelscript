// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon, SlidersIcon, SyncIcon, XIcon, ZapIcon } from "@primer/octicons-react";
import { IconButton, Label, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import styledImport from "styled-components";
import Box from "../../../../components/Box";
import type { ExperimentConfig, SimulationParamItem } from "../../hooks/useClassSimulation";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const DeckWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
`;

const SectionCard = styled.div`
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.03)));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-heading);
`;

const FieldRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
`;

const SelectInput = styled.select`
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-canvas-default, #1e293b);
  color: var(--color-text-primary);
  outline: none;
  &:focus {
    border-color: var(--ms-brand, #06b6d4);
  }
`;

const NumberInput = styled.input`
  font-size: 12px;
  padding: 4px 8px;
  width: 72px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-canvas-default, #1e293b);
  color: var(--color-text-primary);
  text-align: right;
  outline: none;
  font-family: monospace;
  &:focus {
    border-color: var(--ms-brand, #06b6d4);
  }
`;

const SliderTrack = styled.input`
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border);
  accent-color: var(--ms-brand, #06b6d4);
  cursor: pointer;
  margin: 0 8px;
`;

const ParamRow = styled.div<{ $modified: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: ${({ $modified }) =>
    $modified
      ? "var(--ms-brand-soft, rgba(6, 182, 212, 0.08))"
      : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))"};
  border: 1px solid
    ${({ $modified }) =>
      $modified ? "var(--ms-brand, #06b6d4)" : "var(--color-border-muted, rgba(255, 255, 255, 0.06))"};
  transition: all 0.15s ease;
`;

export interface SimulationControlsDeckProps {
  experimentConfig: ExperimentConfig;
  onExperimentConfigChange: (config: ExperimentConfig) => void;
  parameters: SimulationParamItem[];
  parameterOverrides: Map<string, number>;
  onParameterChange: (name: string, value: number) => void;
  onResetParameter: (name: string) => void;
  autoRunOnScrub: boolean;
  onToggleAutoRunOnScrub: (v: boolean) => void;
}

export const SimulationControlsDeck: React.FC<SimulationControlsDeckProps> = ({
  experimentConfig,
  onExperimentConfigChange,
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

  return (
    <DeckWrap>
      {/* ── 1. Experiment Setup ── */}
      <SectionCard>
        <SectionTitle>
          <Box display="flex" alignItems="center" gap="6px">
            <ZapIcon size={14} style={{ color: "var(--ms-brand, #06b6d4)" }} />
            <span>Experiment Setup</span>
          </Box>
        </SectionTitle>

        <FieldRow>
          <Text style={{ color: "var(--color-text-muted)" }}>Stop Time (s):</Text>
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
        </FieldRow>

        <FieldRow>
          <Text style={{ color: "var(--color-text-muted)" }}>Intervals (Steps):</Text>
          <SelectInput
            value={experimentConfig.numberOfIntervals}
            onChange={(e) =>
              onExperimentConfigChange({ ...experimentConfig, numberOfIntervals: Number(e.target.value) })
            }
          >
            <option value="100">100 (Coarse / Ultra-Fast)</option>
            <option value="250">250 (Standard)</option>
            <option value="500">500 (Detailed)</option>
            <option value="1000">1000 (High-Resolution)</option>
            <option value="2500">2500 (Dense)</option>
          </SelectInput>
        </FieldRow>

        <FieldRow>
          <Text style={{ color: "var(--color-text-muted)" }}>Integrator Solver:</Text>
          <SelectInput
            value={experimentConfig.solver}
            onChange={(e) => onExperimentConfigChange({ ...experimentConfig, solver: e.target.value as any })}
          >
            <option value="dopri5">DOPRI5 (Dormand-Prince Adaptive)</option>
            <option value="rk4">RK4 (Runge-Kutta 4th Order)</option>
            <option value="cvode">CVODE (Stiff BDF / Sundials)</option>
            <option value="euler">Euler (1st Order Explicit)</option>
          </SelectInput>
        </FieldRow>
      </SectionCard>

      {/* ── 2. Parameter Scrubbers ── */}
      <SectionCard>
        <SectionTitle>
          <Box display="flex" alignItems="center" gap="6px">
            <SlidersIcon size={14} style={{ color: "var(--ms-brand, #06b6d4)" }} />
            <span>Tunable Parameters ({parameters.length})</span>
          </Box>
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer", fontWeight: 500 }}
          >
            <input
              type="checkbox"
              checked={autoRunOnScrub}
              onChange={(e) => onToggleAutoRunOnScrub(e.target.checked)}
            />
            Auto-solve on scrub
          </label>
        </SectionTitle>

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
            block
            style={{ fontSize: 11, padding: "2px 8px" }}
          />
        )}

        {parameters.length === 0 ? (
          <Text style={{ color: "var(--color-text-muted)", fontSize: 12, fontStyle: "italic", padding: "8px 0" }}>
            No top-level tunable parameters declared on this model.
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 380, overflowY: "auto" }}>
            {filteredParams.map((p) => {
              const isModified = parameterOverrides.has(p.name);
              const minVal = p.min !== undefined ? p.min : p.defaultValue > 0 ? 0 : p.defaultValue * 3;
              const maxVal =
                p.max !== undefined ? p.max : p.defaultValue > 0 ? p.defaultValue * 3 : p.defaultValue < 0 ? 0 : 10;
              const stepVal = maxVal !== minVal ? Math.abs((maxVal - minVal) / 100) : 0.01;

              return (
                <ParamRow key={p.name} $modified={isModified}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap="6px">
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</span>
                      {p.unit && (
                        <Label variant="secondary" style={{ fontSize: 10 }}>
                          {p.unit}
                        </Label>
                      )}
                    </Box>
                    <Box display="flex" alignItems="center" gap="6px">
                      <NumberInput
                        type="number"
                        step="any"
                        value={p.currentValue}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (!isNaN(val)) onParameterChange(p.name, val);
                        }}
                      />
                      {isModified && (
                        <IconButton
                          icon={SyncIcon}
                          size="small"
                          aria-label={`Reset ${p.name} to default (${p.defaultValue})`}
                          title={`Reset to default (${p.defaultValue})`}
                          onClick={() => onResetParameter(p.name)}
                          style={{ color: "var(--ms-brand, #06b6d4)" }}
                        />
                      )}
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center">
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", minWidth: 28 }}>
                      {Number(minVal.toFixed(2))}
                    </span>
                    <SliderTrack
                      type="range"
                      min={minVal}
                      max={maxVal}
                      step={stepVal}
                      value={p.currentValue}
                      onChange={(e) => onParameterChange(p.name, Number(e.target.value))}
                    />
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", minWidth: 28, textAlign: "right" }}>
                      {Number(maxVal.toFixed(2))}
                    </span>
                  </Box>

                  {p.description && (
                    <Text style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{p.description}</Text>
                  )}
                </ParamRow>
              );
            })}
          </div>
        )}
      </SectionCard>
    </DeckWrap>
  );
};
