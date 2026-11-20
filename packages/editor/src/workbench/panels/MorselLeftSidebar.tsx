// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileDirectoryIcon,
  KebabHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SidebarCollapseIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, IconButton, TextInput } from "@primer/react";
import React, { useRef, useState } from "react";
import { useEditorCapabilities as useCapabilities } from "../../host";
import Spinner from "../../internal/Spinner";
import ComponentList from "../ComponentList";
import { getLanguageInfo } from "../constants";
import {
  OptimizationExperimentSettings,
  SimulationExperimentSettings,
  SimulationParameters,
  type ExperimentOverrides,
  type ParameterInfo,
  type SweepState,
} from "../SimulationParameters";
import TreeWidget from "../Tree";
import { getFileIconPath } from "../util/file-icons";
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
  floatingTopOffset?: number | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onAddProjectFile?: ((fileName: string) => void) | undefined;
  onOpenNewModelModal?: (() => void) | undefined;
  isLoadingModel?: boolean | undefined;
  onRemoveProjectFile?: ((fileName: string) => void) | undefined;
  onRenameProjectFile?: ((oldName: string, newName: string) => void) | undefined;
  onMoveProjectFile?: ((fileName: string, targetDir: string) => void) | undefined;
  fileDiagnosticCounts?: Record<string, { errors: number; warnings: number }> | undefined;
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
  floatingTopOffset = 72,
  projectFiles,
  activeFileName,
  onSelectProjectFile,
  onAddProjectFile,
  onOpenNewModelModal,
  isLoadingModel,
  onRemoveProjectFile,
  onRenameProjectFile,
  onMoveProjectFile,
  fileDiagnosticCounts,
}) => {
  const { hasCapability } = useCapabilities();
  const isCaeComputeEnabled = hasCapability("caeCompute");
  const isDraggingTree = useRef(false);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [editingFileOp, setEditingFileOp] = useState<{ fileName: string; mode: "rename" | "move" } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [mobileSection, setMobileSection] = useState<MobileSidebarSection>(() =>
    simulationParameters.length > 0 ? "parameters" : showResultsView ? "variables" : "components",
  );

  if (!treeVisible) return null;

  const langInfo = getLanguageInfo(language || "modelica");
  const isAmpl = langInfo.id === "ampl";
  const isSimulatable = langInfo.supportsSimulation;

  const showLibrariesSection = isNarrow ? mobileSection === "libraries" : !showResultsView;
  const showComponentsSection = isNarrow ? mobileSection === "components" : !showResultsView;
  const showVariablesSection = isNarrow ? mobileSection === "variables" : showResultsView;
  const showParametersSection = isNarrow
    ? mobileSection === "parameters"
    : showResultsView && isSimulatable && !isAmpl && simulationParameters.length > 0;
  const showSolverSection = isNarrow ? mobileSection === "solver" && isSimulatable : showResultsView && isSimulatable;

  const isFloating = Boolean(floating && !isNarrow);
  const isStackedFloating = false;
  const componentCount = Array.isArray(diagramData?.nodes)
    ? diagramData.nodes.filter((c: any) => {
        if (!c?.id || c.id.startsWith("__diagram_") || c.id.startsWith("solder_dot_")) return false;
        if (!c.properties || c.shape === "circle") return false;
        const kind = c.properties?.classKind?.toLowerCase();
        return !(kind && kind.includes("connector"));
      }).length
    : 0;
  const isSearchActive = Boolean(isSearchExpanded || libraryFilter);

  const dividerColor =
    _colorMode === "dark"
      ? "var(--ms-divider, rgba(255, 255, 255, 0.08))"
      : "var(--ms-divider, rgba(15, 23, 42, 0.08))";
  const floatingShadow =
    _colorMode === "dark"
      ? "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 40px -8px rgba(0, 0, 0, 0.56)"
      : "0 1px 0 rgba(255, 255, 255, 0.8) inset, 0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)";
  const floatingCardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    boxSizing: "border-box",
    pointerEvents: "auto",
    backgroundColor: "var(--ms-surface-glass, rgba(255, 255, 255, 0.86))",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    borderRadius: 12,
    border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))",
    boxShadow: floatingShadow,
  };

  return (
    <div
      style={
        isFloating
          ? {
              position: "absolute",
              top: floatingTopOffset,
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
          pointerEvents: "auto",
          backgroundColor: isFloating
            ? "var(--ms-surface-glass, rgba(255, 255, 255, 0.86))"
            : "var(--bgColor-muted, var(--ms-bg-alt))",
          backdropFilter: isFloating ? "blur(14px)" : undefined,
          WebkitBackdropFilter: isFloating ? "blur(14px)" : undefined,
          borderRadius: isNarrow ? 0 : 12,
          border: isNarrow ? "none" : "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))",
          boxShadow: isFloating ? floatingShadow : undefined,
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

        {showLibrariesSection && projectFiles !== undefined && (
          <div
            role="region"
            aria-label="Project files"
            style={
              isStackedFloating
                ? {
                    ...floatingCardStyle,
                    flex: "0 0 20%",
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }
                : {
                    display: "flex",
                    flexDirection: "column",
                    flex: isNarrow ? "0 0 auto" : "0 0 20%",
                    maxHeight: isNarrow ? 240 : undefined,
                    minHeight: 0,
                    borderBottom: `1px solid ${dividerColor}`,
                    overflow: "hidden",
                  }
            }
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 16px",
                minHeight: 40,
                gap: 6,
                borderBottom: `1px solid ${dividerColor}`,
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--ms-text-2, var(--color-fg-muted))",
                  whiteSpace: "nowrap",
                  userSelect: "none",
                }}
              >
                <span>Files ({Object.keys(projectFiles).length})</span>
                {isLoadingModel && <Spinner size="small" />}
              </div>
              {(onOpenNewModelModal || onAddProjectFile) && (
                <IconButton
                  icon={PlusIcon}
                  size="small"
                  variant="invisible"
                  aria-label="New Model or add file"
                  title="New Model"
                  data-testid="files-panel-add-btn"
                  onClick={() => {
                    if (onOpenNewModelModal) {
                      onOpenNewModelModal();
                    } else {
                      setIsAddingFile(true);
                    }
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "6px 8px",
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              {Object.keys(projectFiles).length === 0 && !isAddingFile && (
                <div
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    color: "var(--ms-text-2, var(--color-fg-muted))",
                    lineHeight: 1.4,
                  }}
                >
                  Workspace is empty. Click <strong>+</strong> to add a model or file.
                </div>
              )}
              {(() => {
                const sortedFiles = Object.keys(projectFiles).sort((a, b) => {
                  const aSlash = a.lastIndexOf("/");
                  const bSlash = b.lastIndexOf("/");
                  const aDir = aSlash >= 0 ? a.slice(0, aSlash) : "";
                  const bDir = bSlash >= 0 ? b.slice(0, bSlash) : "";
                  if (aDir !== bDir) {
                    if (!aDir) return -1;
                    if (!bDir) return 1;
                    return aDir.localeCompare(bDir);
                  }
                  return a.localeCompare(b);
                });

                let lastRenderedDir: string | null = null;

                return sortedFiles.map((fileName) => {
                  const slashIdx = fileName.lastIndexOf("/");
                  const dir = slashIdx >= 0 ? fileName.slice(0, slashIdx) : "";
                  const baseName = slashIdx >= 0 ? fileName.slice(slashIdx + 1) : fileName;
                  const showDirHeader = Boolean(dir) && dir !== lastRenderedDir;
                  lastRenderedDir = dir;

                  const isSelected = fileName === activeFileName;
                  const isEditingThis = editingFileOp?.fileName === fileName;
                  const hasActions = Boolean(onRenameProjectFile || onMoveProjectFile || onRemoveProjectFile);

                  const commitEdit = () => {
                    if (!editingFileOp) return;
                    const trimmed = editingValue.trim();
                    if (editingFileOp.mode === "rename") {
                      if (trimmed) {
                        const nextPath = trimmed.includes("/")
                          ? trimmed.replace(/^\/+/, "")
                          : dir
                            ? `${dir}/${trimmed}`
                            : trimmed;
                        if (nextPath !== fileName && !(nextPath in projectFiles)) {
                          onRenameProjectFile?.(fileName, nextPath);
                        }
                      }
                    } else if (editingFileOp.mode === "move") {
                      const cleanDir = trimmed.replace(/^\/+|\/+$/g, "");
                      if (cleanDir !== dir) {
                        onMoveProjectFile?.(fileName, cleanDir);
                      }
                    }
                    setEditingFileOp(null);
                    setEditingValue("");
                  };

                  return (
                    <React.Fragment key={fileName}>
                      {showDirHeader && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 8px 2px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--ms-text-2, var(--color-fg-muted))",
                            fontFamily: "var(--font-mono, monospace)",
                            userSelect: "none",
                          }}
                          title={dir}
                        >
                          <FileDirectoryIcon size={12} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dir}
                          </span>
                        </div>
                      )}
                      {isEditingThis ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitEdit();
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 4px",
                            paddingLeft: dir ? 16 : 4,
                          }}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setEditingFileOp(null);
                                setEditingValue("");
                              }
                            }}
                            onBlur={commitEdit}
                            placeholder={editingFileOp.mode === "move" ? "Directory (empty for root)" : "New file name"}
                            aria-label={
                              editingFileOp.mode === "move" ? `Change directory for ${fileName}` : `Rename ${fileName}`
                            }
                            style={{
                              width: "100%",
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid var(--ms-brand, #0891b2)",
                              background: "var(--bgColor-default, #ffffff)",
                              color: "var(--fgColor-default, #0f172a)",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 12,
                              outline: "none",
                              boxSizing: "border-box",
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            borderRadius: 6,
                            paddingLeft: dir ? 10 : 0,
                            backgroundColor: isSelected
                              ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))"
                              : "transparent",
                          }}
                        >
                          <button
                            type="button"
                            aria-current={isSelected ? "true" : undefined}
                            onClick={() => onSelectProjectFile?.(fileName)}
                            title={fileName}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "5px 8px",
                              border: "none",
                              background: "transparent",
                              color: isSelected
                                ? "var(--ms-link, var(--ms-brand, #0891b2))"
                                : "var(--fgColor-default, var(--color-fg-default))",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: 12,
                              fontWeight: isSelected ? 600 : 400,
                              textAlign: "left",
                              cursor: "pointer",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                flexShrink: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                opacity: isSelected ? 1 : 0.85,
                              }}
                            >
                              <img
                                src={getFileIconPath(fileName)}
                                alt=""
                                width={14}
                                height={14}
                                style={{ display: "block", width: 14, height: 14, objectFit: "contain" }}
                              />
                            </span>
                            <span
                              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {baseName}
                            </span>
                            {(() => {
                              const counts = fileDiagnosticCounts?.[fileName];
                              if (!counts || (counts.errors === 0 && counts.warnings === 0)) return null;
                              return (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                  {counts.errors > 0 && (
                                    <span
                                      title={`${counts.errors} error(s)`}
                                      style={{
                                        padding: "0 5px",
                                        borderRadius: 999,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        lineHeight: "16px",
                                        backgroundColor: "var(--ms-status-fail-bg, rgba(251, 113, 133, 0.16))",
                                        color: "var(--ms-status-fail-fg, #fb7185)",
                                      }}
                                    >
                                      {counts.errors}
                                    </span>
                                  )}
                                  {counts.warnings > 0 && (
                                    <span
                                      title={`${counts.warnings} warning(s)`}
                                      style={{
                                        padding: "0 5px",
                                        borderRadius: 999,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        lineHeight: "16px",
                                        backgroundColor: "var(--ms-status-warn-bg, rgba(251, 191, 36, 0.16))",
                                        color: "var(--ms-status-warn-fg, #fbbf24)",
                                      }}
                                    >
                                      {counts.warnings}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </button>
                          {hasActions && (
                            <ActionMenu>
                              <ActionMenu.Anchor>
                                <IconButton
                                  icon={KebabHorizontalIcon}
                                  size="small"
                                  variant="invisible"
                                  aria-label={`File actions for ${fileName}`}
                                  title={`Actions for ${fileName}`}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ flexShrink: 0, opacity: 0.75 }}
                                />
                              </ActionMenu.Anchor>
                              <ActionMenu.Overlay width="small">
                                <ActionList>
                                  {onRenameProjectFile && (
                                    <ActionList.Item
                                      onSelect={() => {
                                        setEditingFileOp({ fileName, mode: "rename" });
                                        setEditingValue(baseName);
                                      }}
                                    >
                                      <ActionList.LeadingVisual>
                                        <PencilIcon />
                                      </ActionList.LeadingVisual>
                                      Rename
                                    </ActionList.Item>
                                  )}
                                  {onMoveProjectFile && (
                                    <ActionList.Item
                                      onSelect={() => {
                                        setEditingFileOp({ fileName, mode: "move" });
                                        setEditingValue(dir);
                                      }}
                                    >
                                      <ActionList.LeadingVisual>
                                        <FileDirectoryIcon />
                                      </ActionList.LeadingVisual>
                                      Change directory
                                    </ActionList.Item>
                                  )}
                                  {onRemoveProjectFile && (
                                    <ActionList.Item variant="danger" onSelect={() => onRemoveProjectFile(fileName)}>
                                      <ActionList.LeadingVisual>
                                        <TrashIcon />
                                      </ActionList.LeadingVisual>
                                      Delete
                                    </ActionList.Item>
                                  )}
                                </ActionList>
                              </ActionMenu.Overlay>
                            </ActionMenu>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  );
                });
              })()}
              {isAddingFile && onAddProjectFile && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = newFileName.trim();
                    if (trimmed) {
                      onAddProjectFile(trimmed);
                    }
                    setIsAddingFile(false);
                    setNewFileName("");
                  }}
                  style={{ display: "flex", alignItems: "center", padding: "2px 4px" }}
                >
                  <input
                    type="text"
                    autoFocus
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setIsAddingFile(false);
                        setNewFileName("");
                      }
                    }}
                    onBlur={() => {
                      const trimmed = newFileName.trim();
                      if (trimmed) {
                        onAddProjectFile(trimmed);
                      }
                      setIsAddingFile(false);
                      setNewFileName("");
                    }}
                    placeholder="params.ssv or dir/model.mo"
                    style={{
                      width: "100%",
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--borderColor-default, rgba(15, 23, 42, 0.2))",
                      background: "var(--bgColor-default, #ffffff)",
                      color: "var(--fgColor-default, #0f172a)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </form>
              )}
            </div>
          </div>
        )}

        {(showComponentsSection || showVariablesSection) && (
          <div
            style={
              isStackedFloating
                ? {
                    ...floatingCardStyle,
                    flex: showComponentsSection ? "0 0 40%" : "1 1 0%",
                    minHeight: 0,
                  }
                : !isNarrow && showComponentsSection
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      flex: "0 0 40%",
                      minHeight: 0,
                      overflow: "hidden",
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
                <span>{showVariablesSection ? "Plot Variables" : translations.components}</span>
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
            <div
              style={{
                flex: 1,
                overflow: "auto",
                minHeight: 0,
                paddingBottom: isNarrow ? 72 : 0,
              }}
            >
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

        {showLibrariesSection && (
          <div
            style={
              isStackedFloating
                ? {
                    ...floatingCardStyle,
                    flex: "0 0 40%",
                    minHeight: 0,
                  }
                : !isNarrow
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      flex: "0 0 40%",
                      minHeight: 0,
                      overflow: "hidden",
                      borderTop: `1px solid ${dividerColor}`,
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
                    gap: 6,
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
                  <span>{translations.libraries}</span>
                  {isLoadingModel && <Spinner size="small" />}
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
                    (window.location.pathname.startsWith("/editor") ||
                      window.location.pathname.startsWith("/playground") ||
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
                <span>{isAmpl ? "Optimization Settings" : "Simulation Settings"}</span>
                {isSettingsExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </button>
            )}
            <div style={{ padding: "0" }}>
              {(isNarrow || isSettingsExpanded) &&
                (isAmpl ? (
                  <OptimizationExperimentSettings
                    overrides={experimentOverrides}
                    onChange={onExperimentOverrideChange}
                    onReset={onExperimentOverrideReset}
                  />
                ) : (
                  <SimulationExperimentSettings
                    experiment={cachedSimulator?.dae?.experiment}
                    overrides={experimentOverrides}
                    onChange={onExperimentOverrideChange}
                    onReset={onExperimentOverrideReset}
                  />
                ))}
              <div className="p-3" style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" block onClick={onSimulate} disabled={isSimulating}>
                  {isAmpl ? (isSimulating ? "Optimizing…" : "Optimize") : isSimulating ? "Simulating…" : "Simulate"}
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
