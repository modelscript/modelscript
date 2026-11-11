// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React, { Suspense } from "react";
import styledImport from "styled-components";
import Box from "../../../components/Box";
import { useTheme } from "../../../theme";
import { useClassSimulation } from "../hooks/useClassSimulation";
import type { ClassDetail } from "../types";
import { SimSpinner } from "./simulation/SimSpinner";
import { SimulationExperimentBar, SimulationParametersPanel } from "./simulation/SimulationControlsDeck";
import { SimulationTelemetryHeader } from "./simulation/SimulationTelemetryHeader";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const SimulationResults = React.lazy(() =>
  import("../../../components/morsel/SimulationResults").then((m) => ({ default: m.SimulationResults })),
);

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
`;

const CanvasCard = styled.div`
  min-width: 0;
  min-height: 420px;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--color-canvas-default, transparent);
`;

const RerunOverlay = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--ms-border, var(--color-border));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  pointer-events: none;
`;

const EmptyStateWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 380px;
  text-align: center;
  padding: 40px 20px;
  gap: 16px;
`;

export interface ClassSimulationTabProps {
  libraryName: string;
  version: string;
  className: string;
  cls: ClassDetail;
  hasCae?: boolean | undefined;
  onOpenCloudStudies?: (() => void) | undefined;
}

export const ClassSimulationTab: React.FC<ClassSimulationTabProps> = ({
  libraryName,
  version,
  className,
  cls,
  hasCae,
  onOpenCloudStudies,
}) => {
  const { theme } = useTheme();
  const colorMode = theme === "dark" ? "dark" : "light";

  const {
    sourceCode,
    experimentConfig,
    setExperimentConfig,
    parameters,
    parameterOverrides,
    isSimulating,
    simulationError,
    lastSolveDurationMs,
    chartData,
    availableStates,
    autoRunOnScrub,
    setAutoRunOnScrub,
    runSimulation,
    handleParameterChange,
    handleResetParameter,
    handleResetAllParameters,
  } = useClassSimulation({
    libraryName,
    version,
    className,
    cls,
    active: true,
  });

  return (
    <Container>
      {/* ── Top Telemetry & Global Actions ── */}
      <SimulationTelemetryHeader
        className={className}
        isSimulating={isSimulating}
        simulationError={simulationError}
        lastSolveDurationMs={lastSolveDurationMs}
        pointsCount={chartData?.length ?? null}
        solver={experimentConfig.solver}
        hasOverrides={parameterOverrides.size > 0}
        onRunSimulation={() => runSimulation()}
        onResetParameters={handleResetAllParameters}
        sourceSnippet={sourceCode}
        hasCae={hasCae}
        onOpenCloudStudies={onOpenCloudStudies}
      />

      {/* ── Vertical stack: plot → solver settings → parameters ── */}
      <Stack>
        <CanvasCard>
          {isSimulating && !chartData ? (
            <EmptyStateWrap>
              <SimSpinner size={36} />
              <Heading as="h4" style={{ margin: 0, fontSize: 16 }}>
                Simulating {className.split(".").pop()}…
              </Heading>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 360 }}>
                Compiling DAE in WebAssembly and solving with {experimentConfig.solver.toUpperCase()} integrator.
              </Text>
            </EmptyStateWrap>
          ) : simulationError && (!chartData || availableStates.length === 0) ? (
            <EmptyStateWrap>
              <AlertIcon size={40} fill="var(--color-danger-fg, #ef4444)" />
              <Heading as="h4" style={{ margin: 0, fontSize: 16, color: "var(--color-danger-fg, #ef4444)" }}>
                Simulation Failed
              </Heading>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 520 }}>{simulationError}</Text>
              <Box display="flex" gap="10px" mt={2}>
                <Button size="small" onClick={() => runSimulation()}>
                  Retry Simulation
                </Button>
                {hasCae && onOpenCloudStudies && (
                  <Button size="small" variant="primary" onClick={onOpenCloudStudies}>
                    Try in Cloud CAE
                  </Button>
                )}
              </Box>
            </EmptyStateWrap>
          ) : chartData && chartData.length > 0 ? (
            <Suspense
              fallback={
                <EmptyStateWrap>
                  <SimSpinner size={28} />
                  <Text style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Rendering Trajectory…</Text>
                </EmptyStateWrap>
              }
            >
              <div style={{ position: "relative" }}>
                <SimulationResults
                  localData={chartData}
                  simulationVariables={availableStates}
                  modelName={className}
                  error={simulationError}
                  onRetry={() => runSimulation()}
                  colorMode={colorMode}
                />
                {isSimulating && (
                  <RerunOverlay>
                    <SimSpinner size={18} />
                    <span>Re-simulating…</span>
                  </RerunOverlay>
                )}
              </div>
            </Suspense>
          ) : (
            <EmptyStateWrap>
              <PulseIcon size={40} style={{ color: "var(--ms-brand, #06b6d4)" }} />
              <Heading as="h4" style={{ margin: 0, fontSize: 16 }}>
                Ready to Simulate in Browser
              </Heading>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 400 }}>
                Click below to compile and simulate this model in WebAssembly using ModelScript&apos;s client-side
                solver.
              </Text>
              <Button
                variant="primary"
                leadingVisual={PlayIcon}
                onClick={() => runSimulation()}
                style={{ marginTop: 8 }}
              >
                Run Simulation
              </Button>
            </EmptyStateWrap>
          )}
        </CanvasCard>

        <SimulationExperimentBar experimentConfig={experimentConfig} onExperimentConfigChange={setExperimentConfig} />

        <SimulationParametersPanel
          parameters={parameters}
          parameterOverrides={parameterOverrides}
          onParameterChange={handleParameterChange}
          onResetParameter={handleResetParameter}
          autoRunOnScrub={autoRunOnScrub}
          onToggleAutoRunOnScrub={setAutoRunOnScrub}
        />
      </Stack>
    </Container>
  );
};
