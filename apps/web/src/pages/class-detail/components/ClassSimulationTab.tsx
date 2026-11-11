// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Heading, Spinner, Text } from "@primer/react";
import React, { Suspense } from "react";
import styledImport from "styled-components";
import Box from "../../../components/Box";
import { useTheme } from "../../../theme";
import { useClassSimulation } from "../hooks/useClassSimulation";
import type { ClassDetail } from "../types";
import { SimulationControlsDeck } from "./simulation/SimulationControlsDeck";
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

const MainGrid = styled.div`
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
  align-items: start;
  width: 100%;

  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
`;

const CanvasCard = styled.div`
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.03)));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 12px;
  padding: 16px;
  min-height: 480px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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

      {/* ── Main Dual-Pane Workspace ── */}
      <MainGrid>
        {/* Left Column: Parameter & Experiment Deck */}
        <SimulationControlsDeck
          experimentConfig={experimentConfig}
          onExperimentConfigChange={setExperimentConfig}
          parameters={parameters}
          parameterOverrides={parameterOverrides}
          onParameterChange={handleParameterChange}
          onResetParameter={handleResetParameter}
          autoRunOnScrub={autoRunOnScrub}
          onToggleAutoRunOnScrub={setAutoRunOnScrub}
        />

        {/* Right Column: High-Fidelity Simulation Trajectory Canvas */}
        <CanvasCard>
          {isSimulating && !chartData ? (
            <EmptyStateWrap>
              <Spinner size="large" />
              <Heading as="h4" style={{ margin: 0, fontSize: 16 }}>
                Simulating {className.split(".").pop()}…
              </Heading>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 360 }}>
                Compiling DAE in WebAssembly and solving with {experimentConfig.solver.toUpperCase()} integrator.
              </Text>
            </EmptyStateWrap>
          ) : simulationError && !chartData ? (
            <EmptyStateWrap>
              <AlertIcon size={40} fill="var(--color-danger-fg, #ef4444)" />
              <Heading as="h4" style={{ margin: 0, fontSize: 16, color: "var(--color-danger-fg, #ef4444)" }}>
                Simulation Failed
              </Heading>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 440 }}>{simulationError}</Text>
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
                  <Spinner size="medium" />
                  <Text style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Rendering Trajectory…</Text>
                </EmptyStateWrap>
              }
            >
              <SimulationResults
                localData={chartData}
                simulationVariables={availableStates}
                modelName={className}
                error={simulationError}
                onRetry={() => runSimulation()}
                colorMode={colorMode}
              />
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
      </MainGrid>
    </Container>
  );
};
