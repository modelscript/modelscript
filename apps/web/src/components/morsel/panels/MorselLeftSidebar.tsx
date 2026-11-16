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
import { MorselResizeHandle } from "./MorselResizeHandle";

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
  floating?: boolean | undefined;
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
  floating = false,
}) => {
  const { hasCapability } = useCapabilities();
  const isCaeComputeEnabled = hasCapability("caeCompute");
  const isDraggingTree = useRef(false);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [librariesSplit, setLibrariesSplit] = useState(0.55);
  const [isSplitting, setIsSplitting] = useState(false);
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

  const isFloating = Boolean(floating && !isNarrow);
  const isStackedFloating = isFloating && showLibrariesSection && showComponentsSection;
  const componentCount = Array.isArray(diagramData?.nodes)
    ? diagramData.nodes.filter((c: any) => {
        if (!c?.id || c.id.startsWith("__diagram_") || c.id.startsWith("solder_dot_")) return false;
        if (!c.properties || c.shape === "circle") return false;
        const kind = c.properties?.classKind?.toLowerCase();
        return !(kind && kind.includes("connector"));
      }).length
    : 0;
  const hasComponents = componentCount > 0;
  const canResizeLibrariesSplit = !isNarrow && showLibrariesSection && showComponentsSection && hasComponents;
  const isSearchActive = Boolean(isSearchExpanded || libraryFilter);

  const dividerColor =
    _colorMode === "dark"
      ? "var(--ms-divider, rgba(255, 255, 255, 0.08))"
      : "var(--ms-divider, rgba(15, 23, 42, 0.08))";
  const floatingShadow =
    _colorMode === "dark"
      ? "0 12px 36px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.28)"
      : "0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)";
  const floatingCardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    boxSizing: "border-box",
    pointerEvents: "auto",
    backgroundColor: _colorMode === "dark" ? "rgba(24, 24, 27, 0.94)" : "rgba(255, 255, 255, 0.96)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    borderRadius: 8,
    border: "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))",
    boxShadow: floatingShadow,
  };

  return (
    <div
      style={
        isFloating
          ? {
              position: "absolute",
              top: 70,
              left: 12,
              bottom: 12,
              zIndex: 30,
              display: "flex",
              flexDirection: "row",
              pointerEvents: "none",
            }
          : {
              display: "contents",
            }
      }
    >
      <div
        ref={columnRef}
        style={
          isStackedFloating
            ? {
                width: treeWidth,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                height: "100%",
                minWidth: 200,
                maxWidth: 600,
                flexShrink: 0,
                boxSizing: "border-box",
                pointerEvents: "none",
              }
            : {
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
                pointerEvents: "auto",
                backgroundColor: isFloating
                  ? _colorMode === "dark"
                    ? "rgba(24, 24, 27, 0.94)"
                    : "rgba(255, 255, 255, 0.96)"
                  : "var(--bgColor-muted, var(--ms-bg-alt))",
                backdropFilter: isFloating ? "blur(14px)" : undefined,
                WebkitBackdropFilter: isFloating ? "blur(14px)" : undefined,
                borderRadius: isNarrow ? 0 : 8,
                border: isNarrow ? "none" : "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))",
                boxShadow: isFloating ? floatingShadow : undefined,
              }
        }
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
          <div
            style={
              isStackedFloating
                ? {
                    ...floatingCardStyle,
                    flex: hasComponents ? `${librariesSplit} 1 0%` : "1 1 0%",
                    minHeight: 120,
                  }
                : canResizeLibrariesSplit
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      flex: `${librariesSplit} 1 0%`,
                      minHeight: 120,
                      overflow: "hidden",
                    }
                  : { display: "contents" }
            }
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: isSearchActive ? "8px 12px" : "8px 16px",
                minHeight: 44,
                gap: 6,
                backgroundColor: "transparent",
                borderBottom: `1px solid ${dividerColor}`,
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              {!isSearchActive && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--ms-text-2, var(--color-fg-muted))",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                    flexShrink: 0,
                  }}
                >
                  {translations.libraries}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flex: isSearchActive ? "1 1 auto" : "0 0 auto",
                  minWidth: 0,
                  gap: 2,
                }}
              >
                {isSearchActive ? (
                  <TextInput
                    ref={inputRef}
                    size="small"
                    block
                    autoFocus
                    leadingVisual={SearchIcon}
                    aria-label={translations.filterClasses}
                    placeholder={translations.filterClasses}
                    value={libraryFilter}
                    onChange={(e) => setLibraryFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        if (libraryFilter) {
                          setLibraryFilter("");
                        } else {
                          setIsSearchExpanded(false);
                        }
                      }
                    }}
                    onBlur={() => {
                      if (!libraryFilter) setIsSearchExpanded(false);
                    }}
                    trailingAction={
                      !isSearching ? (
                        <TextInput.Action
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (libraryFilter) {
                              setLibraryFilter("");
                              inputRef.current?.focus();
                            } else {
                              setIsSearchExpanded(false);
                            }
                          }}
                          icon={XIcon}
                          aria-label={libraryFilter ? "Clear search" : "Close search"}
                        />
                      ) : undefined
                    }
                    trailingVisual={isSearching ? <Spinner size="small" /> : undefined}
                    style={{
                      height: 26,
                      minHeight: 26,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                ) : (
                  <IconButton
                    icon={SearchIcon}
                    aria-label={translations.filterClasses}
                    title={translations.filterClasses}
                    size="small"
                    variant="invisible"
                    onClick={() => {
                      setIsSearchExpanded(true);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                    }}
                  />
                )}
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
                colorMode={_colorMode}
              />
            </div>
          </div>
        )}

        {canResizeLibrariesSplit ? (
          <MorselResizeHandle
            orientation="horizontal"
            cursor="row-resize"
            ariaLabel="Resize Libraries and Components"
            ariaValueNow={Math.round(librariesSplit * 100)}
            ariaValueMin={25}
            ariaValueMax={80}
            isDragging={isSplitting}
            style={{
              height: 8,
              width: "100%",
              marginTop: isStackedFloating ? 0 : -4,
              marginBottom: isStackedFloating ? 0 : -4,
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setLibrariesSplit((prev) => Math.max(0.25, Number((prev - 0.05).toFixed(2))));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setLibrariesSplit((prev) => Math.min(0.8, Number((prev + 0.05).toFixed(2))));
              } else if (e.key === "Home") {
                e.preventDefault();
                setLibrariesSplit(0.25);
              } else if (e.key === "End") {
                e.preventDefault();
                setLibrariesSplit(0.8);
              }
            }}
            onDoubleClick={() => {
              setLibrariesSplit(0.55);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsSplitting(true);
              const startY = e.clientY;
              const startSplit = librariesSplit;
              const totalHeight = columnRef.current?.clientHeight ?? 600;
              const usableHeight = Math.max(240, totalHeight - 8);

              const onMouseMove = (ev: MouseEvent) => {
                const deltaY = ev.clientY - startY;
                const next = Math.max(0.25, Math.min(0.8, startSplit + deltaY / usableHeight));
                setLibrariesSplit(next);
              };

              const onMouseUp = () => {
                setIsSplitting(false);
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                document.body.style.cursor = "auto";
                document.body.style.userSelect = "auto";
              };

              document.addEventListener("mousemove", onMouseMove);
              document.addEventListener("mouseup", onMouseUp);
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
            }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              if (!touch) return;
              setIsSplitting(true);
              const startY = touch.clientY;
              const startSplit = librariesSplit;
              const totalHeight = columnRef.current?.clientHeight ?? 600;
              const usableHeight = Math.max(240, totalHeight - 8);

              const onTouchMove = (ev: TouchEvent) => {
                const t = ev.touches[0];
                if (!t) return;
                const deltaY = t.clientY - startY;
                const next = Math.max(0.25, Math.min(0.8, startSplit + deltaY / usableHeight));
                setLibrariesSplit(next);
              };

              const onTouchEnd = () => {
                setIsSplitting(false);
                document.removeEventListener("touchmove", onTouchMove);
                document.removeEventListener("touchend", onTouchEnd);
                document.body.style.userSelect = "auto";
              };

              document.addEventListener("touchmove", onTouchMove, { passive: true });
              document.addEventListener("touchend", onTouchEnd);
              document.body.style.userSelect = "none";
            }}
          />
        ) : (
          isStackedFloating && <div style={{ height: 8, flexShrink: 0 }} />
        )}

        {(showComponentsSection || showVariablesSection) && (
          <div
            style={
              isStackedFloating
                ? {
                    ...floatingCardStyle,
                    flex: hasComponents ? `${1 - librariesSplit} 1 0%` : "0 0 auto",
                    minHeight: hasComponents ? 120 : undefined,
                  }
                : canResizeLibrariesSplit
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      flex: `${1 - librariesSplit} 1 0%`,
                      minHeight: 120,
                      overflow: "hidden",
                      borderTop: `1px solid ${dividerColor}`,
                    }
                  : { display: "contents" }
            }
          >
            {!isNarrow && (
              <div
                className="d-flex flex-items-center flex-justify-between"
                style={{
                  minHeight: 44,
                  padding: "8px 16px",
                  boxSizing: "border-box",
                  borderTop: isStackedFloating ? "none" : `1px solid ${dividerColor}`,
                  borderBottom: `1px solid ${dividerColor}`,
                  backgroundColor: "transparent",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--ms-text-2, var(--color-fg-muted))",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                <span>{showVariablesSection ? "Simulation Variables" : translations.components}</span>
                {showComponentsSection && componentCount > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 999,
                      backgroundColor: _colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)",
                      color: "var(--ms-text-2, var(--color-fg-muted))",
                    }}
                  >
                    {componentCount}
                  </span>
                )}
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, paddingBottom: isNarrow ? 72 : 0 }}>
              {showComponentsSection ? (
                <ComponentList
                  components={diagramData?.nodes ?? null}
                  onSelect={onSelectComponent}
                  onHighlight={onTreeHighlight}
                  selectedName={selectedComponent}
                  language={language}
                  translations={translations}
                  uri={documentUri}
                  colorMode={_colorMode}
                />
              ) : (
                <VariablesTree
                  variables={simulationVariables ?? []}
                  selectedVariables={selectedSimulationVariables}
                  onToggleVariable={onToggleSimulationVariable}
                />
              )}
            </div>
          </div>
        )}

        {showParametersSection && (
          <>
            {!isNarrow && (
              <div
                className="d-flex flex-items-center"
                style={{
                  minHeight: 44,
                  padding: "8px 16px",
                  boxSizing: "border-box",
                  borderTop: `1px solid ${dividerColor}`,
                  borderBottom: `1px solid ${dividerColor}`,
                  backgroundColor: "transparent",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--ms-text-2, var(--color-fg-muted))",
                  userSelect: "none",
                }}
              >
                <span>Simulation Parameters</span>
              </div>
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
                className="d-flex flex-items-center flex-justify-between"
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "8px 16px",
                  boxSizing: "border-box",
                  borderLeft: "none",
                  borderRight: "none",
                  borderTop: `1px solid ${dividerColor}`,
                  borderBottom: `1px solid ${dividerColor}`,
                  backgroundColor: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--ms-text-2, var(--color-fg-muted))",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  userSelect: "none",
                }}
              >
                <span>Simulation Settings</span>
                {isSettingsExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
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
        <MorselResizeHandle
          orientation="vertical"
          ariaLabel={translations.collapseTree || "Resize sidebar"}
          ariaValueNow={treeWidth}
          ariaValueMin={200}
          ariaValueMax={600}
          isDragging={isDragging}
          style={{
            width: 8,
            marginLeft: isFloating ? 2 : -4,
            marginRight: isFloating ? -10 : -4,
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
        />
      )}
    </div>
  );
};
