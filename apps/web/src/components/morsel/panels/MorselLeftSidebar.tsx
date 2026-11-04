// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SearchIcon, ServerIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton, TextInput } from "@primer/react";
import React, { useRef, useState } from "react";
import { useCapabilities } from "../../../CapabilitiesContext";
import Spinner from "../../Spinner";
import ComponentList from "../ComponentList";
import {
  SimulationExperimentSettings,
  SimulationParameters,
  type ExperimentOverrides,
  type ParameterInfo,
  type SweepState,
} from "../SimulationParameters";
import TreeWidget from "../Tree";
import { VariablesTree } from "../VariablesTree";

export interface MorselLeftSidebarProps {
  treeVisible: boolean;
  isNarrow: boolean;
  treeWidth: number;
  setTreeWidth: (w: number) => void;
  colorMode: "dark" | "light";
  showResultsView: boolean;
  translations: any;
  libraryFilter: string;
  setLibraryFilter: (f: string) => void;
  isSearchExpanded: boolean;
  setIsSearchExpanded: (v: boolean) => void;
  isSearching: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  addLibraryButtonRef: React.RefObject<HTMLButtonElement | null>;
  onOpenAddLibrary: () => void;
  documentUri: string;
  debouncedFilter: string;
  onTreeSelect: (name: string, kind?: string) => void;
  onTreeHighlight: (name: string | null) => void;
  contextVersion: number;
  language: string | null;
  diagramData: any;
  selectedComponent: string | null;
  onSelectComponent: (name: string | null) => void;
  simulationVariables: string[] | undefined;
  selectedSimulationVariables: string[];
  onToggleSimulationVariable: (v: string) => void;
  simulationParameters: ParameterInfo[];
  parameterOverrides: Map<string, number>;
  onParameterChange: (name: string, value: number) => void;
  onParameterReset: (name: string) => void;
  sweepState: SweepState | null;
  onSweepChange: (s: SweepState | null) => void;
  experimentOverrides: ExperimentOverrides;
  onExperimentOverrideChange: (name: string, value: any) => void;
  onExperimentOverrideReset: (name: string) => void;
  cachedSimulator: any;
  onSimulate: () => void;
  onOpenCloud: () => void;
  isSimulating: boolean;
}

export type MobileSidebarSection = "parameters" | "variables" | "components" | "libraries" | "solver";

export const MorselLeftSidebar: React.FC<MorselLeftSidebarProps> = ({
  treeVisible,
  isNarrow,
  treeWidth,
  setTreeWidth,
  colorMode,
  showResultsView,
  translations,
  libraryFilter,
  setLibraryFilter,
  isSearchExpanded,
  setIsSearchExpanded,
  isSearching,
  inputRef,
  addLibraryButtonRef,
  onOpenAddLibrary,
  documentUri,
  debouncedFilter,
  onTreeSelect,
  onTreeHighlight,
  contextVersion,
  language,
  diagramData,
  selectedComponent,
  onSelectComponent,
  simulationVariables,
  selectedSimulationVariables,
  onToggleSimulationVariable,
  simulationParameters,
  parameterOverrides,
  onParameterChange,
  onParameterReset,
  sweepState,
  onSweepChange,
  experimentOverrides,
  onExperimentOverrideChange,
  onExperimentOverrideReset,
  cachedSimulator,
  onSimulate,
  onOpenCloud,
  isSimulating,
}) => {
  const { hasCapability } = useCapabilities();
  const isCaeComputeEnabled = hasCapability("caeCompute");
  const isDraggingTree = useRef(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);
  const [mobileSection, setMobileSection] = useState<MobileSidebarSection>(() =>
    simulationParameters.length > 0 ? "parameters" : showResultsView ? "variables" : "components",
  );

  if (!treeVisible) return null;

  const showLibrariesSection = isNarrow ? mobileSection === "libraries" : !showResultsView;
  const showComponentsSection = isNarrow ? mobileSection === "components" : !showResultsView;
  const showVariablesSection = isNarrow ? mobileSection === "variables" : showResultsView;
  const showParametersSection = isNarrow
    ? mobileSection === "parameters"
    : showResultsView && simulationParameters.length > 0;
  const showSolverSection = isNarrow ? mobileSection === "solver" : showResultsView;

  return (
    <>
      <div
        style={{
          width: isNarrow ? "100%" : treeWidth,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
          minWidth: isNarrow ? 0 : 200,
          maxWidth: isNarrow ? "100%" : 600,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {isNarrow && (
          <div
            role="tablist"
            aria-label="Model tuning and inspection sections"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              overflowX: "auto",
              borderBottom: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              flexShrink: 0,
            }}
          >
            {(
              [
                { id: "parameters", label: "Parameters", count: simulationParameters.length },
                { id: "variables", label: "Variables", count: simulationVariables?.length ?? 0 },
                {
                  id: "components",
                  label: translations.components || "Components",
                  count: diagramData?.nodes?.length ?? 0,
                },
                { id: "libraries", label: translations.libraries || "Libraries" },
                { id: "solver", label: "Solver" },
              ] as const
            ).map((sec) => {
              const active = mobileSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMobileSection(sec.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 30,
                    padding: "0 11px",
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active
                      ? "color-mix(in srgb, var(--ms-brand, #0891b2) 45%, transparent)"
                      : "var(--color-border-default)",
                    background: active ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                    color: active ? "var(--ms-link, #0891b2)" : "var(--color-fg-muted)",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <span>{sec.label}</span>
                  {"count" in sec && typeof sec.count === "number" && sec.count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "0 5px",
                        borderRadius: 999,
                        background: active ? "rgba(8, 145, 178, 0.22)" : "var(--color-canvas-subtle)",
                      }}
                    >
                      {sec.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {showLibrariesSection && (
          <>
            <div
              className="text-bold px-3 py-2 border-bottom bg-canvas-subtle d-flex flex-items-center flex-justify-between"
              style={{ gap: 8 }}
            >
              <div
                className="d-flex flex-items-center"
                style={{ display: isSearchExpanded || libraryFilter ? "none" : "flex" }}
              >
                {translations.libraries}
              </div>
              <div className="d-flex flex-items-center flex-1 flex-justify-end" style={{ minWidth: 0 }}>
                <TextInput
                  ref={inputRef}
                  aria-label={translations.filterClasses}
                  placeholder={translations.filterClasses}
                  value={libraryFilter}
                  onChange={(e) => setLibraryFilter(e.target.value)}
                  onBlur={() => {
                    if (!libraryFilter) setIsSearchExpanded(false);
                  }}
                  trailingAction={
                    !isSearching && (isSearchExpanded || libraryFilter) ? (
                      <TextInput.Action
                        onClick={() => {
                          if (libraryFilter) {
                            setLibraryFilter("");
                            inputRef.current?.focus();
                          } else {
                            setIsSearchExpanded(false);
                          }
                        }}
                        icon={libraryFilter ? XIcon : SearchIcon}
                        aria-label={libraryFilter ? "Clear search" : "Close search"}
                      />
                    ) : undefined
                  }
                  trailingVisual={
                    isSearching && (isSearchExpanded || libraryFilter) ? (
                      <Spinner size="small" style={{ marginTop: "6px", marginInlineStart: "8px" }} />
                    ) : undefined
                  }
                  className={isSearchExpanded || libraryFilter ? "input-sm" : "input-sm border-0"}
                  style={{
                    width: isSearchExpanded || libraryFilter ? "100%" : "0px",
                    opacity: isSearchExpanded || libraryFilter ? 1 : 0,
                    padding: isSearchExpanded || libraryFilter ? undefined : "0px",
                    borderWidth: isSearchExpanded || libraryFilter ? undefined : "0px",
                    height: "28px",
                    transition: "all 0.2s ease-in-out",
                    overflow: "hidden",
                  }}
                />
                <IconButton
                  icon={SearchIcon}
                  aria-label={translations.filterClasses}
                  size="small"
                  variant="invisible"
                  onClick={() => {
                    setIsSearchExpanded(true);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  style={{
                    width: isSearchExpanded || libraryFilter ? "0px" : "28px",
                    opacity: isSearchExpanded || libraryFilter ? 0 : 1,
                    padding: isSearchExpanded || libraryFilter ? "0px" : undefined,
                    overflow: "hidden",
                    transition: "all 0.2s ease-in-out",
                  }}
                />
                <IconButton
                  icon={PlusIcon}
                  aria-label={translations.addLibrary}
                  size="small"
                  variant="invisible"
                  ref={addLibraryButtonRef}
                  onClick={onOpenAddLibrary}
                />
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, paddingBottom: isNarrow ? 72 : 0 }}>
              <TreeWidget
                uri={documentUri}
                onSelect={onTreeSelect}
                onHighlight={onTreeHighlight}
                width="100%"
                filter={debouncedFilter}
                version={contextVersion}
                language={language}
              />
            </div>
          </>
        )}

        {(showComponentsSection || showVariablesSection) && (
          <>
            {!isNarrow && (
              <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
                {showVariablesSection ? "Simulation Variables" : translations.components}
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, paddingBottom: isNarrow ? 72 : 0 }}>
              {showComponentsSection ? (
                <ComponentList
                  components={diagramData?.nodes ?? null}
                  onSelect={onSelectComponent}
                  selectedName={selectedComponent}
                  language={language}
                  translations={translations}
                />
              ) : (
                <VariablesTree
                  variables={simulationVariables ?? []}
                  selectedVariables={selectedSimulationVariables}
                  onToggleVariable={onToggleSimulationVariable}
                />
              )}
            </div>
          </>
        )}

        {showParametersSection && (
          <>
            {!isNarrow && (
              <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">Simulation Parameters</div>
            )}
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, paddingBottom: isNarrow ? 72 : 0 }}>
              {simulationParameters.length > 0 ? (
                <SimulationParameters
                  parameters={simulationParameters}
                  overrides={parameterOverrides}
                  sweepState={sweepState}
                  onChange={onParameterChange}
                  onReset={onParameterReset}
                  onSweepChange={onSweepChange}
                />
              ) : (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    color: "var(--color-fg-muted)",
                    fontSize: "13px",
                  }}
                >
                  Run a simulation first or switch to <b>Components</b> / <b>Solver</b> to configure this model.
                </div>
              )}
            </div>
          </>
        )}

        {showSolverSection && (
          <div
            style={{
              flex: isNarrow ? 1 : undefined,
              overflowY: isNarrow ? "auto" : undefined,
              paddingBottom: isNarrow ? 72 : 0,
            }}
          >
            {!isNarrow && (
              <button
                type="button"
                onClick={() => setIsSettingsExpanded((prev) => !prev)}
                aria-expanded={isSettingsExpanded}
                className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle d-flex flex-items-center flex-justify-between"
                style={{
                  width: "100%",
                  borderLeft: "none",
                  borderRight: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "inherit",
                  fontSize: "inherit",
                }}
              >
                <span>Simulation Settings</span>
                {isSettingsExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
              </button>
            )}
            <div style={{ padding: "0" }}>
              {(isNarrow || isSettingsExpanded) && (
                <SimulationExperimentSettings
                  experiment={cachedSimulator?.dae?.experiment}
                  overrides={experimentOverrides}
                  onChange={onExperimentOverrideChange}
                  onReset={onExperimentOverrideReset}
                />
              )}
              <div className="p-3" style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" block onClick={onSimulate} disabled={isSimulating}>
                  Simulate
                </Button>
                {isCaeComputeEnabled && (
                  <Button
                    variant="default"
                    onClick={onOpenCloud}
                    leadingVisual={ServerIcon}
                    title="Run on Ansatz Cloud HPC"
                  >
                    Cloud
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {!isNarrow && (
        <div
          style={{
            width: 6,
            cursor: "col-resize",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            backgroundColor: "transparent",
            display: "flex",
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingTree.current = true;
            const startX = e.clientX;
            const startWidth = treeWidth;

            const onMouseMove = (e: MouseEvent) => {
              if (!isDraggingTree.current) return;
              const deltaX = e.clientX - startX;
              const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
              setTreeWidth(newWidth);
            };

            const onMouseUp = () => {
              isDraggingTree.current = false;
              document.removeEventListener("mousemove", onMouseMove);
              document.removeEventListener("mouseup", onMouseUp);
              document.body.style.cursor = "auto";
              document.body.style.userSelect = "auto";
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
          }}
        />
      )}
      <div className="border-left" />
    </>
  );
};
