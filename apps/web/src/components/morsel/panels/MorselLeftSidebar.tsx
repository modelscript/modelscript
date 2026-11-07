// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SidebarCollapseIcon,
  XIcon,
} from "@primer/octicons-react";
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
  setTreeVisible?: (v: boolean | ((prev: boolean) => boolean)) => void;
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
  setTreeVisible,
  isNarrow,
  treeWidth,
  setTreeWidth,
  colorMode: _colorMode,
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
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
        className={isNarrow ? undefined : "border-right"}
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
          boxSizing: "border-box",
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
              className="text-bold px-3 border-bottom bg-canvas-subtle d-flex flex-items-center flex-justify-between"
              style={{
                height: 36,
                gap: 6,
                backgroundColor: "var(--color-canvas-subtle)",
                borderBottom: "1px solid var(--color-border-subtle, var(--ms-border, rgba(15, 23, 42, 0.1)))",
                boxSizing: "border-box",
              }}
            >
              <div
                className="d-flex flex-items-center"
                style={{
                  display: isSearchExpanded || libraryFilter ? "none" : "flex",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: "var(--color-fg-default)",
                }}
              >
                {translations.libraries}
              </div>
              <div className="d-flex flex-items-center flex-1 flex-justify-end" style={{ minWidth: 0, gap: 2 }}>
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
                    borderRadius: 6,
                    fontSize: 12,
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
                    height: "28px",
                    borderRadius: 6,
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
                  style={{ width: 28, height: 28, borderRadius: 6 }}
                />
                {setTreeVisible &&
                  !(
                    typeof window !== "undefined" &&
                    (window.location.pathname.startsWith("/playground") ||
                      window.location.pathname.startsWith("/sketch") ||
                      window.location.pathname.startsWith("/morsel"))
                  ) && (
                    <IconButton
                      icon={SidebarCollapseIcon}
                      aria-label={translations.collapseTree || "Collapse Libraries sidebar"}
                      title={translations.collapseTree || "Collapse Libraries sidebar"}
                      size="small"
                      variant="invisible"
                      onClick={() => {
                        setTreeVisible(false);
                        if (typeof window !== "undefined") {
                          window.dispatchEvent(new CustomEvent("morsel:sidebar-changed", { detail: { open: false } }));
                        }
                      }}
                      style={{ width: 28, height: 28, borderRadius: 6 }}
                    />
                  )}
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
                  uri={documentUri}
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
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={treeWidth}
          aria-valuemin={200}
          aria-valuemax={600}
          aria-label={translations.collapseTree || "Resize sidebar"}
          tabIndex={0}
          style={{
            width: 10,
            marginLeft: -5,
            marginRight: -5,
            cursor: "col-resize",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            display: "flex",
            position: "relative",
            zIndex: 10,
            backgroundColor: "transparent",
            outline: "none",
            userSelect: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setTreeWidth(Math.max(200, Math.min(600, treeWidth - 10)));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setTreeWidth(Math.max(200, Math.min(600, treeWidth + 10)));
            } else if (e.key === "Home") {
              e.preventDefault();
              setTreeWidth(200);
            } else if (e.key === "End") {
              e.preventDefault();
              setTreeWidth(600);
            }
          }}
          onDoubleClick={() => {
            setTreeWidth(260);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingTree.current = true;
            setIsDragging(true);
            const startX = e.clientX;
            const startWidth = treeWidth;

            const onMouseMove = (ev: MouseEvent) => {
              if (!isDraggingTree.current) return;
              const deltaX = ev.clientX - startX;
              const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
              setTreeWidth(newWidth);
            };

            const onMouseUp = () => {
              isDraggingTree.current = false;
              setIsDragging(false);
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
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (!touch) return;
            isDraggingTree.current = true;
            setIsDragging(true);
            const startX = touch.clientX;
            const startWidth = treeWidth;

            const onTouchMove = (ev: TouchEvent) => {
              if (!isDraggingTree.current) return;
              const t = ev.touches[0];
              if (!t) return;
              const deltaX = t.clientX - startX;
              const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
              setTreeWidth(newWidth);
            };

            const onTouchEnd = () => {
              isDraggingTree.current = false;
              setIsDragging(false);
              document.removeEventListener("touchmove", onTouchMove);
              document.removeEventListener("touchend", onTouchEnd);
              document.body.style.userSelect = "auto";
            };

            document.addEventListener("touchmove", onTouchMove, { passive: true });
            document.addEventListener("touchend", onTouchEnd);
            document.body.style.userSelect = "none";
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Active highlight line centered on the border */}
          <div
            style={{
              width: 2,
              height: "100%",
              backgroundColor: isHovered || isDragging ? "var(--ms-brand, #0891b2)" : "transparent",
              transition: "background-color 0.15s ease",
            }}
          />
          {/* Subtle grab pill in the vertical center */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              width: 4,
              height: 28,
              borderRadius: 999,
              backgroundColor: isHovered || isDragging ? "var(--ms-brand, #0891b2)" : "transparent",
              boxShadow:
                isHovered || isDragging
                  ? "0 0 6px color-mix(in srgb, var(--ms-brand, #0891b2) 50%, transparent)"
                  : "none",
              opacity: isHovered || isDragging ? 1 : 0,
              transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
              pointerEvents: "none",
            }}
          />
        </div>
      )}
    </>
  );
};
