// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlusIcon, SearchIcon, ServerIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton, Spinner, TextInput } from "@primer/react";
import React, { useRef } from "react";
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
  const isDraggingTree = useRef(false);

  if (!treeVisible) return null;

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
        {!showResultsView && (
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
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <TreeWidget
                uri={documentUri}
                key={debouncedFilter ? "filtered" : "unfiltered"}
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
        <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
          {showResultsView ? "Simulation Variables" : translations.components}
        </div>
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {!showResultsView ? (
            <ComponentList
              components={diagramData?.nodes ?? null}
              onSelect={onSelectComponent}
              selectedName={selectedComponent}
              language={language}
              translations={translations}
            />
          ) : (
            <VariablesTree
              variables={simulationVariables}
              selectedVariables={selectedSimulationVariables}
              onToggleVariable={onToggleSimulationVariable}
            />
          )}
        </div>
        {showResultsView && simulationParameters.length > 0 && (
          <>
            <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">Simulation Parameters</div>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <SimulationParameters
                parameters={simulationParameters}
                overrides={parameterOverrides}
                sweepState={sweepState}
                onChange={onParameterChange}
                onReset={onParameterReset}
                onSweepChange={onSweepChange}
              />
            </div>
          </>
        )}
        {showResultsView && (
          <>
            <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">Simulation Settings</div>
            <div style={{ padding: "0" }}>
              <SimulationExperimentSettings
                experiment={cachedSimulator?.dae?.experiment}
                overrides={experimentOverrides}
                onChange={onExperimentOverrideChange}
                onReset={onExperimentOverrideReset}
              />
              <div className="p-3" style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" block onClick={onSimulate} disabled={isSimulating}>
                  Simulate
                </Button>
                <Button
                  variant="default"
                  onClick={onOpenCloud}
                  leadingVisual={ServerIcon}
                  title="Run on ModelScript Cloud HPC"
                >
                  Cloud
                </Button>
              </div>
            </div>
          </>
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
