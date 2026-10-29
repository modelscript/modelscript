// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  exportTabularSheetToCsv,
  exportTabularSheetToTsv,
  type CompiledTabularPayload,
  type SerializedTabularColumn,
  type TabularMutationRequest,
  type TabularRow,
} from "@modelscript/dsl/dsl";
import { buildReqIfDiagram, renderReqIfDiagramSvg } from "@modelscript/reqif/diagram";
import {
  applyReqIfTabularMutation,
  executeReqIfTabular,
  REQIF_ASIL_BADGE_MAP,
  REQIF_ENTAILMENT_BADGE_MAP,
  REQIF_MATRIX_LINK_KINDS,
  REQIF_STATUS_BADGE_MAP,
  validateReqIfTabularCell,
} from "@modelscript/reqif/tabular";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TableIcon,
  TrashIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface ReqifViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    specId?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
  onCodeChange?: ((newXml: string) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

type PrimaryViewMode = "tabular" | "diagram" | "split" | "code";
type ActiveSheetId = "requirements" | "matrix" | "traceability" | "types";

const DEFAULT_REQIF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-FCS-DAL-A">
      <REQ-IF-VERSION>1.2</REQ-IF-VERSION>
      <TITLE>DO-178C DAL-A Primary Flight Control Specification</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STR" LONG-NAME="UTF-8 Text"/>
        <DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="DT-VERIF" LONG-NAME="Verification Method">
          <SPECIFIED-VALUES>
            <ENUM-VALUE IDENTIFIER="EV-HIL" LONG-NAME="HIL Simulation"/>
            <ENUM-VALUE IDENTIFIER="EV-PROOF" LONG-NAME="Formal Proof"/>
            <ENUM-VALUE IDENTIFIER="EV-TEST" LONG-NAME="Flight Test"/>
          </SPECIFIED-VALUES>
        </DATATYPE-DEFINITION-ENUMERATION>
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="SOT-SYS-REQ" LONG-NAME="System Safety Requirement">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-TEXT" LONG-NAME="ReqIF.Text"/>
            <ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="AD-VERIF" LONG-NAME="Verification">
              <TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>DT-VERIF</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE>
            </ATTRIBUTE-DEFINITION-ENUMERATION>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-014" LONG-NAME="Pitch Step Overshoot Envelope" ASIL="ASIL-D" STATUS="Verified">
          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-SYS-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The primary flight control law shall maintain pitch step overshoot &lt;= 2.5 % across the full flight envelope (ASIL-D).</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-ENUMERATION>
              <DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>AD-VERIF</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION>
              <VALUES><ENUM-VALUE-REF>Formal Proof</ENUM-VALUE-REF></VALUES>
            </ATTRIBUTE-VALUE-ENUMERATION>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-028" LONG-NAME="Inner-Loop Pitch Damper Bound" ASIL="ASIL-D" STATUS="Verified">
          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-SYS-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The inner-loop pitch damper shall bound transient overshoot &lt;= 1.8 % under gust disturbance (ASIL-D).</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-ENUMERATION>
              <DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>AD-VERIF</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION>
              <VALUES><ENUM-VALUE-REF>HIL Simulation</ENUM-VALUE-REF></VALUES>
            </ATTRIBUTE-VALUE-ENUMERATION>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-042" LONG-NAME="Actuator Command Transport Latency" ASIL="ASIL-D" STATUS="Approved">
          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-SYS-REQ</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The servo-loop transport delay shall satisfy latency &lt;= 5.0 ms from stick input to surface command (ASIL-D).</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-ENUMERATION>
              <DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>AD-VERIF</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION>
              <VALUES><ENUM-VALUE-REF>HIL Simulation</ENUM-VALUE-REF></VALUES>
            </ATTRIBUTE-VALUE-ENUMERATION>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="refines">
          <SOURCE><SPEC-OBJECT-REF>REQ-FCS-028</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-FCS-014</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
        <SPEC-RELATION IDENTIFIER="REL-02" LONG-NAME="satisfies">
          <SOURCE><SPEC-OBJECT-REF>REQ-FCS-042</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-FCS-028</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-FCS-01" LONG-NAME="DO-178C DAL-A Primary Flight Control Specification">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-FCS-014</SPEC-OBJECT-REF></OBJECT>
              <CHILDREN>
                <SPEC-HIERARCHY IDENTIFIER="SH-1-1">
                  <OBJECT><SPEC-OBJECT-REF>REQ-FCS-028</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
                <SPEC-HIERARCHY IDENTIFIER="SH-1-2">
                  <OBJECT><SPEC-OBJECT-REF>REQ-FCS-042</SPEC-OBJECT-REF></OBJECT>
                </SPEC-HIERARCHY>
              </CHILDREN>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

const Container = styled.div<{ $isDark: boolean; $isFullScreen?: boolean }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: ${(p) => (p.$isFullScreen ? "100%" : "auto")};
  min-height: ${(p) => (p.$isFullScreen ? "640px" : "430px")};
  background: ${(p) => (p.$isDark ? "#0b1120" : "#ffffff")};
  color: ${(p) => (p.$isDark ? "#e2e8f0" : "#0f172a")};
  border-radius: ${(p) => (p.$isFullScreen ? "0" : "8px")};
  overflow: hidden;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    sans-serif;
`;

const TopBar = styled.div<{ $isDark: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: ${(p) => (p.$isDark ? "#0f172a" : "#f8fafc")};
  border-bottom: 1px solid ${(p) => (p.$isDark ? "#1e293b" : "#e2e8f0")};
`;

const KpiRibbon = styled.div<{ $isDark: boolean }>`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  padding: 8px 12px;
  background: ${(p) => (p.$isDark ? "rgba(15, 23, 42, 0.65)" : "#f8fafc")};
  border-bottom: 1px solid ${(p) => (p.$isDark ? "#1e293b" : "#e2e8f0")};
`;

const KpiCard = styled.button<{
  $isDark: boolean;
  $active: boolean;
  $accent: string;
}>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 10px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  transition: all 0.14s ease;
  background: ${(p) =>
    p.$active
      ? p.$isDark
        ? "rgba(56, 189, 248, 0.14)"
        : "rgba(2, 132, 199, 0.08)"
      : p.$isDark
        ? "#111827"
        : "#ffffff"};
  border: 1px solid ${(p) => (p.$active ? p.$accent : p.$isDark ? "rgba(51, 65, 85, 0.8)" : "#e2e8f0")};
  &:hover {
    border-color: ${(p) => p.$accent};
  }
`;

const SubToolbar = styled.div<{ $isDark: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 12px;
  background: ${(p) => (p.$isDark ? "#0f172a" : "#f1f5f9")};
  border-bottom: 1px solid ${(p) => (p.$isDark ? "#1e293b" : "#e2e8f0")};
`;

const PillButton = styled.button<{ $isDark: boolean; $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
  background: ${(p) =>
    p.$active ? (p.$isDark ? "#0284c7" : "#0284c7") : p.$isDark ? "rgba(30, 41, 59, 0.85)" : "#ffffff"};
  color: ${(p) => (p.$active ? "#ffffff" : p.$isDark ? "#cbd5e1" : "#334155")};
  border: 1px solid ${(p) => (p.$active ? "#0284c7" : p.$isDark ? "#334155" : "#cbd5e1")};
  &:hover {
    border-color: #38bdf8;
  }
`;

const TableViewport = styled.div<{ $isDark: boolean; $isFullScreen?: boolean }>`
  flex: 1;
  width: 100%;
  max-height: ${(p) => (p.$isFullScreen ? "calc(100vh - 210px)" : "360px")};
  overflow: auto;
  background: ${(p) => (p.$isDark ? "#0b1120" : "#ffffff")};
`;

const StyledTable = styled.table<{ $isDark: boolean; $dense: boolean }>`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: ${(p) => (p.$dense ? "11.5px" : "12.5px")};

  th {
    position: sticky;
    top: 0;
    z-index: 3;
    background: ${(p) => (p.$isDark ? "#111827" : "#f8fafc")};
    color: ${(p) => (p.$isDark ? "#94a3b8" : "#475569")};
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: ${(p) => (p.$dense ? "6px 8px" : "8px 10px")};
    text-align: left;
    border-bottom: 1px solid ${(p) => (p.$isDark ? "#1e293b" : "#e2e8f0")};
    border-right: 1px solid ${(p) => (p.$isDark ? "rgba(30, 41, 59, 0.65)" : "#f1f5f9")};
    white-space: nowrap;
    user-select: none;
  }

  td {
    padding: ${(p) => (p.$dense ? "5px 8px" : "8px 10px")};
    border-bottom: 1px solid ${(p) => (p.$isDark ? "rgba(30, 41, 59, 0.7)" : "#f1f5f9")};
    border-right: 1px solid ${(p) => (p.$isDark ? "rgba(30, 41, 59, 0.45)" : "#f8fafc")};
    vertical-align: middle;
    color: ${(p) => (p.$isDark ? "#e2e8f0" : "#1e293b")};
  }

  tbody tr:hover td {
    background: ${(p) => (p.$isDark ? "rgba(30, 41, 59, 0.45)" : "rgba(241, 245, 249, 0.7)")};
  }
`;

const BadgePill = styled.span<{
  $bg?: string;
  $color?: string;
  $border?: string;
}>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
  background: ${(p) => p.$bg || "rgba(148, 163, 184, 0.14)"};
  color: ${(p) => p.$color || "#94a3b8"};
  border: 1px solid ${(p) => p.$border || "rgba(148, 163, 184, 0.35)"};
`;

const InlineInput = styled.input<{ $isDark: boolean; $hasError?: boolean }>`
  width: 100%;
  min-width: 90px;
  padding: 3px 6px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 4px;
  outline: none;
  background: ${(p) => (p.$isDark ? "#0f172a" : "#ffffff")};
  color: ${(p) => (p.$isDark ? "#f8fafc" : "#0f172a")};
  border: 1.5px solid ${(p) => (p.$hasError ? "#ef4444" : "#38bdf8")};
`;

const InlineSelect = styled.select<{ $isDark: boolean }>`
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  border-radius: 5px;
  cursor: pointer;
  background: ${(p) => (p.$isDark ? "#1e293b" : "#f8fafc")};
  color: ${(p) => (p.$isDark ? "#e2e8f0" : "#0f172a")};
  border: 1px solid ${(p) => (p.$isDark ? "#334155" : "#cbd5e1")};
`;

const NEXT_LINK_CYCLE: (string | null)[] = [
  "satisfies",
  "verifies",
  "refines",
  "allocates",
  "derives",
  "conflicts",
  null,
];

export const ReqifViewer: React.FC<ReqifViewerProps> = ({
  viewConfig,
  isFullScreen = false,
  onCodeChange,
  onRevealLine,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const navigate = useNavigate();

  const initialSource = useMemo(() => {
    if (typeof viewConfig?.code === "string" && viewConfig.code.trim().length > 0) {
      return viewConfig.code;
    }
    return DEFAULT_REQIF_XML;
  }, [viewConfig?.code]);

  const [xmlText, setXmlText] = useState<string>(initialSource);
  const [baselineXml, setBaselineXml] = useState<string>(initialSource);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [mode, setMode] = useState<PrimaryViewMode>("tabular");
  const [activeSheet, setActiveSheet] = useState<ActiveSheetId>("requirements");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeKpiFilter, setActiveKpiFilter] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [denseMode, setDenseMode] = useState<boolean>(false);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnId: string;
    value: string;
    error?: string | undefined;
  } | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync if viewConfig.code changes or fetch from URL if needed
  useEffect(() => {
    if (typeof viewConfig?.code === "string" && viewConfig.code.trim().length > 0) {
      setXmlText(viewConfig.code);
      setBaselineXml(viewConfig.code);
      return;
    }
    if (typeof viewConfig?.url === "string" && viewConfig.url.trim().length > 0) {
      let cancelled = false;
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((txt) => {
          if (!cancelled && txt.trim()) {
            setXmlText(txt);
            setBaselineXml(txt);
          }
        })
        .catch(() => {
          // Keep fallback XML
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [viewConfig?.code, viewConfig?.url]);

  // Execute the ReqIF Tabular DSL sheet
  const tabularPayload: CompiledTabularPayload = useMemo(
    () => executeReqIfTabular(xmlText, activeSheet),
    [xmlText, activeSheet],
  );

  // Always compute requirements sheet KPIs for the top telemetry ribbon
  const requirementsPayload: CompiledTabularPayload = useMemo(
    () => (activeSheet === "requirements" ? tabularPayload : executeReqIfTabular(xmlText, "requirements")),
    [xmlText, activeSheet, tabularPayload],
  );

  // Build 2D Diagram model & SVG on demand
  const diagramData = useMemo(() => {
    const model = buildReqIfDiagram(xmlText);
    const svg = renderReqIfDiagramSvg(model, { isDark });
    return { model, svg };
  }, [xmlText, isDark]);

  const isEdited = xmlText !== baselineXml;

  const revealRequirementInEditor = useCallback(
    (reqId: string) => {
      if (!onRevealLine) return;
      const lines = xmlText.split(/\r?\n/);
      const idx = lines.findIndex((l) => l.includes(`IDENTIFIER="${reqId}"`));
      if (idx >= 0) {
        onRevealLine(idx + 1, reqId);
      }
    },
    [xmlText, onRevealLine],
  );

  const applyMutation = useCallback(
    (mutation: TabularMutationRequest) => {
      const res = applyReqIfTabularMutation(xmlText, mutation);
      if (res.success && res.newText !== xmlText) {
        setUndoStack((prev) => [...prev.slice(-19), xmlText]);
        setXmlText(res.newText);
        onCodeChange?.(res.newText);
      }
      return res;
    },
    [xmlText, onCodeChange],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previousXml = prev[prev.length - 1]!;
      setXmlText(previousXml);
      onCodeChange?.(previousXml);
      return prev.slice(0, -1);
    });
  }, [onCodeChange]);

  const handleReset = useCallback(() => {
    setUndoStack([]);
    setXmlText(baselineXml);
    onCodeChange?.(baselineXml);
    setEditingCell(null);
  }, [baselineXml, onCodeChange]);

  const commitInlineEdit = useCallback(() => {
    if (!editingCell) return;
    const validation = validateReqIfTabularCell(
      xmlText,
      activeSheet,
      editingCell.rowId,
      editingCell.columnId,
      editingCell.value,
    );
    if (!validation.valid) {
      setEditingCell({ ...editingCell, error: validation.message });
      return;
    }
    applyMutation({
      kind: "updateCell",
      sheetId: activeSheet,
      rowId: editingCell.rowId,
      columnId: editingCell.columnId,
      value: editingCell.value,
    });
    setEditingCell(null);
  }, [editingCell, xmlText, activeSheet, applyMutation]);

  const handleAddRow = useCallback(() => {
    applyMutation({
      kind: "insertRow",
      sheetId: activeSheet === "traceability" ? "traceability" : "requirements",
    });
  }, [activeSheet, applyMutation]);

  const handleDeleteRow = useCallback(
    (rowId: string) => {
      applyMutation({
        kind: "deleteRow",
        sheetId: activeSheet === "traceability" ? "traceability" : "requirements",
        rowId,
      });
    },
    [activeSheet, applyMutation],
  );

  const handleCycleMatrixCell = useCallback(
    (rowId: string, colId: string, currentKind: string | undefined) => {
      if (rowId === colId) return;
      const idx = currentKind ? NEXT_LINK_CYCLE.indexOf(currentKind) : -1;
      const nextKind = idx >= 0 ? (NEXT_LINK_CYCLE[(idx + 1) % NEXT_LINK_CYCLE.length] ?? null) : "satisfies";
      applyMutation({
        kind: "toggleMatrixCell",
        sheetId: "matrix",
        rowId,
        colId,
        newKind: nextKind,
      });
    },
    [applyMutation],
  );

  // Filter & sort rows
  const visibleRows: TabularRow[] = useMemo(() => {
    let list = tabularPayload.rows;

    // Hierarchy collapse filtering for tree sheets
    if (tabularPayload.sheetKind === "tree" && collapsedRowIds.size > 0) {
      const hiddenAncestors = new Set(collapsedRowIds);
      list = list.filter((row) => {
        if (row.parentId && hiddenAncestors.has(row.parentId)) {
          hiddenAncestors.add(row.id);
          return false;
        }
        return true;
      });
    }

    // KPI quick-filter
    if (activeKpiFilter && activeSheet === "requirements") {
      if (activeKpiFilter === "contracts") {
        list = list.filter((r) => Boolean(r.cells.contract));
      } else if (activeKpiFilter === "coverage") {
        list = list.filter((r) => Boolean(r.cells.relations));
      } else if (activeKpiFilter === "entailment") {
        list = list.filter((r) => r.cells.entailment === "Certified" || r.cells.entailment === "Gap");
      }
    }

    // Text search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        Object.values(row.cells).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }

    // Column sort
    if (sortColumn) {
      list = [...list].sort((a, b) => {
        const va = String(a.cells[sortColumn] ?? "");
        const vb = String(b.cells[sortColumn] ?? "");
        const cmp = va.localeCompare(vb, undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      });
    }

    return list;
  }, [
    tabularPayload.rows,
    tabularPayload.sheetKind,
    collapsedRowIds,
    activeKpiFilter,
    activeSheet,
    searchQuery,
    sortColumn,
    sortAsc,
  ]);

  const handleCopyCsvOrTsv = useCallback(
    (format: "csv" | "tsv" | "xml") => {
      const textToCopy =
        format === "csv"
          ? exportTabularSheetToCsv(tabularPayload)
          : format === "tsv"
            ? exportTabularSheetToTsv(tabularPayload)
            : xmlText;
      navigator.clipboard?.writeText(textToCopy);
      setCopiedFeedback(format.toUpperCase());
      setTimeout(() => setCopiedFeedback(null), 1800);
    },
    [tabularPayload, xmlText],
  );

  const handleDownloadReqIf = useCallback(() => {
    const blob = new Blob([xmlText], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(viewConfig?.specId as string) || "specification"}.reqif`;
    a.click();
    URL.revokeObjectURL(url);
  }, [xmlText, viewConfig?.specId]);

  const handleOpenInPlayground = useCallback(() => {
    const encoded = compressMorselPayload({
      code: xmlText,
      dialect: "reqif",
    });
    navigate(`/morsel?m=${encoded}`);
  }, [xmlText, navigate]);

  const renderCellContent = (row: TabularRow, col: SerializedTabularColumn) => {
    const rawVal = row.cells[col.id];
    const strVal = rawVal === null || rawVal === undefined ? "" : String(rawVal);

    const isEditingThis = editingCell?.rowId === row.id && editingCell?.columnId === col.id;

    if (isEditingThis) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <InlineInput
            $isDark={isDark}
            $hasError={Boolean(editingCell.error)}
            autoFocus
            value={editingCell.value}
            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value, error: undefined })}
            onBlur={commitInlineEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitInlineEdit();
              if (e.key === "Escape") setEditingCell(null);
            }}
          />
          {editingCell.error && <span style={{ color: "#f87171", fontSize: 10 }}>{editingCell.error}</span>}
        </div>
      );
    }

    // Indent & tree chevron for `identifier` column in tree sheet
    if (col.id === "identifier" && tabularPayload.sheetKind === "tree") {
      const depth = row.depth ?? 0;
      const hasChildren = (row.childIds?.length ?? 0) > 0;
      const isCollapsed = collapsedRowIds.has(row.id);

      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            paddingLeft: depth * 14,
            fontFamily: "JetBrains Mono, monospace",
            fontWeight: 700,
            color: "#38bdf8",
            whiteSpace: "nowrap",
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedRowIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                });
              }}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: isDark ? "#94a3b8" : "#64748b",
                display: "inline-flex",
              }}
              title={isCollapsed ? "Expand child requirements" : "Collapse child requirements"}
            >
              {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
            </button>
          ) : (
            <span style={{ width: 12, display: "inline-block" }} />
          )}
          <span
            onClick={() => revealRequirementInEditor(row.id)}
            style={{ cursor: onRevealLine ? "pointer" : "default" }}
            title={onRevealLine ? `Reveal ${row.id} in XML editor` : undefined}
          >
            {strVal}
          </span>
        </div>
      );
    }

    // Enum dropdown columns (ASIL, Status, Relation Stereotype, or dynamic Enum attributes)
    if (col.type === "enum" && col.editable && col.options && col.options.length > 0) {
      const badge = col.badgeMap?.[strVal] || REQIF_ASIL_BADGE_MAP[strVal] || REQIF_STATUS_BADGE_MAP[strVal];
      return (
        <InlineSelect
          $isDark={isDark}
          value={strVal}
          style={
            badge
              ? {
                  background: badge.background,
                  color: badge.color,
                  borderColor: badge.borderColor,
                }
              : undefined
          }
          onChange={(e) =>
            applyMutation({
              kind: "updateCell",
              sheetId: activeSheet,
              rowId: row.id,
              columnId: col.id,
              value: e.target.value,
            })
          }
        >
          {col.options.map((opt) => {
            const val = typeof opt === "string" ? opt : opt.value;
            const label = typeof opt === "string" ? opt : opt.label;
            return (
              <option
                key={val}
                value={val}
                style={{ background: isDark ? "#0f172a" : "#ffffff", color: isDark ? "#e2e8f0" : "#0f172a" }}
              >
                {label}
              </option>
            );
          })}
        </InlineSelect>
      );
    }

    // Reference dropdown in traceability sheet (`sourceId` / `targetId`)
    if (activeSheet === "traceability" && (col.id === "sourceId" || col.id === "targetId") && col.editable) {
      const reqIds = requirementsPayload.rows.map((r) => r.id);
      return (
        <InlineSelect
          $isDark={isDark}
          value={strVal}
          onChange={(e) =>
            applyMutation({
              kind: "updateCell",
              sheetId: "traceability",
              rowId: row.id,
              columnId: col.id,
              value: e.target.value,
            })
          }
        >
          {reqIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </InlineSelect>
      );
    }

    // Formal Contract cell with math badge styling
    if (col.type === "contract") {
      return (
        <div
          onDoubleClick={() => col.editable && setEditingCell({ rowId: row.id, columnId: col.id, value: strVal })}
          title="Double-click to edit formal mathematical contract (e.g. overshoot <= 2.5 %)"
          style={{ cursor: col.editable ? "pointer" : "default" }}
        >
          {strVal ? (
            <BadgePill $bg="rgba(6, 182, 212, 0.14)" $color="#22d3ee" $border="rgba(6, 182, 212, 0.4)">
              ⊨ {strVal}
            </BadgePill>
          ) : (
            <span
              style={{
                fontSize: 11,
                color: isDark ? "#64748b" : "#94a3b8",
                fontStyle: "italic",
              }}
            >
              + Add contract…
            </span>
          )}
        </div>
      );
    }

    // Read-only badge columns (Entailment, Contract Consistency, Schema Category)
    if (col.type === "badge") {
      const badge = col.badgeMap?.[strVal] || REQIF_ENTAILMENT_BADGE_MAP[strVal] || REQIF_STATUS_BADGE_MAP[strVal];
      return (
        <BadgePill
          $bg={badge?.background}
          $color={badge?.color}
          $border={badge?.borderColor}
          title={row.metadata?.entailmentExplanation || strVal}
        >
          {strVal || "—"}
        </BadgePill>
      );
    }

    // Editable text / xhtml / number cells
    return (
      <div
        onDoubleClick={() => col.editable && setEditingCell({ rowId: row.id, columnId: col.id, value: strVal })}
        title={col.editable ? "Double-click to edit cell (syncs to ReqIF XML)" : strVal}
        style={{
          cursor: col.editable ? "text" : "default",
          lineHeight: 1.4,
          fontWeight: col.id === "longName" ? 600 : 400,
          fontFamily: col.id === "section" ? "JetBrains Mono, monospace" : "inherit",
        }}
      >
        {strVal || <span style={{ color: isDark ? "#475569" : "#cbd5e1" }}>—</span>}
      </div>
    );
  };

  const renderMatrixView = () => {
    const matrix = tabularPayload.matrix;
    if (!matrix) return null;

    return (
      <TableViewport $isDark={isDark} $isFullScreen={isFullScreen}>
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11.5,
            color: isDark ? "#94a3b8" : "#475569",
            borderBottom: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>
            Click any off-diagonal cell <strong>(Source Row → Target Column)</strong> to cycle{" "}
            <code>SPEC-RELATION</code> traceability links directly in ReqIF XML:
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {REQIF_MATRIX_LINK_KINDS.map((lk) => (
              <BadgePill
                key={lk.id}
                $bg={lk.badge?.background}
                $color={lk.badge?.color}
                $border={lk.badge?.borderColor}
              >
                {lk.shortLabel}: «{lk.label}»
              </BadgePill>
            ))}
          </div>
        </div>

        <StyledTable $isDark={isDark} $dense={denseMode}>
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Source ↓ \ Target →</th>
              {matrix.colHeaders.map((col) => (
                <th key={col.id} style={{ textAlign: "center", minWidth: 118 }}>
                  <div style={{ color: "#38bdf8", fontFamily: "JetBrains Mono, monospace" }}>{col.label}</div>
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 400,
                      textTransform: "none",
                      color: isDark ? "#64748b" : "#94a3b8",
                      maxWidth: 120,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {col.subtitle}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rowHeaders.map((rowH) => (
              <tr key={rowH.id}>
                <td style={{ fontWeight: 600 }}>
                  <div
                    style={{
                      color: "#38bdf8",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 11.5,
                    }}
                  >
                    {rowH.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: isDark ? "#94a3b8" : "#64748b",
                      fontWeight: 400,
                    }}
                  >
                    {rowH.subtitle}
                  </div>
                </td>
                {matrix.colHeaders.map((colH) => {
                  const isDiagonal = rowH.id === colH.id;
                  const cellKey = `${rowH.id}::${colH.id}`;
                  const cell = matrix.cells[cellKey];
                  const lk = cell ? REQIF_MATRIX_LINK_KINDS.find((k) => k.id === cell.kind) : undefined;

                  return (
                    <td
                      key={colH.id}
                      onClick={() => !isDiagonal && handleCycleMatrixCell(rowH.id, colH.id, cell?.kind)}
                      title={
                        isDiagonal
                          ? "Self-reference diagonal"
                          : cell
                            ? `${rowH.id} «${cell.kind}» ${colH.id} (Click to cycle or remove)`
                            : `Click to create SPEC-RELATION from ${rowH.id} to ${colH.id}`
                      }
                      style={{
                        textAlign: "center",
                        cursor: isDiagonal ? "not-allowed" : "pointer",
                        background: isDiagonal
                          ? isDark
                            ? "rgba(15, 23, 42, 0.85)"
                            : "#f1f5f9"
                          : cell
                            ? "rgba(2, 132, 199, 0.06)"
                            : undefined,
                      }}
                    >
                      {isDiagonal ? (
                        <span style={{ color: isDark ? "#334155" : "#cbd5e1" }}>—</span>
                      ) : cell && lk ? (
                        <BadgePill $bg={lk.badge?.background} $color={lk.badge?.color} $border={lk.badge?.borderColor}>
                          «{lk.label}»
                        </BadgePill>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            color: isDark ? "#334155" : "#cbd5e1",
                          }}
                        >
                          +
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </StyledTable>
      </TableViewport>
    );
  };

  const renderTabularPane = () => {
    if (activeSheet === "matrix") {
      return renderMatrixView();
    }

    const visibleColumns = tabularPayload.columns.filter((c) => !c.hidden);

    return (
      <TableViewport $isDark={isDark} $isFullScreen={isFullScreen}>
        <StyledTable $isDark={isDark} $dense={denseMode}>
          <thead>
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  style={{
                    width: col.width,
                    minWidth: col.minWidth ?? 80,
                    cursor: col.sortable ? "pointer" : "default",
                  }}
                  title={col.description || col.header}
                  onClick={() => {
                    if (!col.sortable) return;
                    if (sortColumn === col.id) {
                      setSortAsc(!sortAsc);
                    } else {
                      setSortColumn(col.id);
                      setSortAsc(true);
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span>{col.header}</span>
                    {col.isDynamic && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 4px",
                          borderRadius: 3,
                          background: "rgba(56, 189, 248, 0.15)",
                          color: "#38bdf8",
                        }}
                      >
                        SPEC-TYPE
                      </span>
                    )}
                    {sortColumn === col.id && <span style={{ color: "#38bdf8" }}>{sortAsc ? "▲" : "▼"}</span>}
                  </div>
                </th>
              ))}
              {tabularPayload.capabilities.canDeleteRow && <th style={{ width: 42, textAlign: "center" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (tabularPayload.capabilities.canDeleteRow ? 1 : 0)}
                  style={{
                    textAlign: "center",
                    padding: "28px 16px",
                    color: isDark ? "#64748b" : "#94a3b8",
                  }}
                >
                  No matching rows in this sheet.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.id}>
                  {visibleColumns.map((col) => (
                    <td key={col.id}>{renderCellContent(row, col)}</td>
                  ))}
                  {tabularPayload.capabilities.canDeleteRow && (
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        title={`Delete ${row.id}`}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: isDark ? "#64748b" : "#94a3b8",
                          cursor: "pointer",
                          padding: 3,
                        }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </StyledTable>
      </TableViewport>
    );
  };

  const renderDiagramPane = () => {
    const selectedNode = selectedNodeId ? diagramData.model.nodes.find((n) => n.id === selectedNodeId) : undefined;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: isFullScreen ? "480px" : "340px",
          background: isDark ? "#0b1120" : "#f8fafc",
          position: "relative",
          overflow: " auto",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 300,
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            const target = (e.target as HTMLElement).closest("[data-reqif-id]");
            if (target) {
              setSelectedNodeId(target.getAttribute("data-reqif-id"));
            }
          }}
          dangerouslySetInnerHTML={{
            __html: sanitizeSvgMarkup(diagramData.svg),
          }}
        />
        {selectedNode && (
          <div
            style={{
              padding: "8px 14px",
              background: isDark ? "#111827" : "#ffffff",
              borderTop: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12,
            }}
          >
            <div>
              <strong style={{ color: "#38bdf8", fontFamily: "JetBrains Mono, monospace" }}>{selectedNode.id}</strong> —{" "}
              <strong>{selectedNode.title}</strong>:{" "}
              <span style={{ color: isDark ? "#94a3b8" : "#475569" }}>{selectedNode.text}</span>
            </div>
            <PillButton
              $isDark={isDark}
              onClick={() => {
                setMode("tabular");
                setActiveSheet("requirements");
                setSearchQuery(selectedNode.id);
              }}
            >
              Edit in Table
            </PillButton>
          </div>
        )}
      </div>
    );
  };

  const renderCodePane = () => {
    const lines = xmlText.split(/\r?\n/);
    return (
      <div
        style={{
          flex: 1,
          maxHeight: isFullScreen ? "calc(100vh - 210px)" : "360px",
          overflow: "auto",
          background: isDark ? "#090d16" : "#f8fafc",
          padding: "10px 14px",
          fontFamily: "JetBrains Mono, Fira Code, monospace",
          fontSize: 11.5,
          lineHeight: 1.55,
        }}
      >
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: "flex", gap: 12 }}>
            <span
              style={{
                width: 32,
                textAlign: "right",
                color: isDark ? "#475569" : "#94a3b8",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <span style={{ whiteSpace: "pre" }}>{highlightPolyglotLine(line, "reqif")}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Container $isDark={isDark} $isFullScreen={isFullScreen} data-testid="reqif-viewer">
      {/* Top Header & Primary Mode Switcher */}
      <TopBar $isDark={isDark}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <BadgePill $bg="rgba(2, 132, 199, 0.16)" $color="#38bdf8" $border="rgba(56, 189, 248, 0.4)">
            OMG ReqIF 1.2
          </BadgePill>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {(viewConfig?.title as string) || diagramData.model.title}
          </span>
          {isEdited && (
            <BadgePill $bg="rgba(245, 158, 11, 0.16)" $color="#fbbf24" $border="rgba(245, 158, 11, 0.45)">
              ● Edited (Synced to XML)
            </BadgePill>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <PillButton
            $isDark={isDark}
            $active={mode === "tabular"}
            onClick={() => setMode("tabular")}
            title="Bidirectional ReqIF Spreadsheet & RTM Editor"
          >
            <TableIcon size={13} />
            Tabular Editor
          </PillButton>
          <PillButton
            $isDark={isDark}
            $active={mode === "diagram"}
            onClick={() => setMode("diagram")}
            title="2D Requirements Architecture & Traceability Diagram"
          >
            <WorkflowIcon size={13} />
            Diagram
          </PillButton>
          <PillButton
            $isDark={isDark}
            $active={mode === "split"}
            onClick={() => setMode("split")}
            title="Live Side-by-Side Tabular Editor + XML Source"
          >
            <SyncIcon size={13} />
            Split Sync
          </PillButton>
          <PillButton
            $isDark={isDark}
            $active={mode === "code"}
            onClick={() => setMode("code")}
            title="OMG ReqIF 1.2 XML Source"
          >
            <CodeIcon size={13} />
            ReqIF XML
          </PillButton>
        </div>
      </TopBar>

      {/* Live KPI Telemetry Ribbon */}
      <KpiRibbon $isDark={isDark}>
        {requirementsPayload.kpis.map((kpi) => {
          const isActive = activeKpiFilter === kpi.id;
          const accent =
            kpi.status === "error" ? "#ef4444" : kpi.status === "warn" ? "#f59e0b" : kpi.accentColor || "#38bdf8";
          return (
            <KpiCard
              key={kpi.id}
              type="button"
              $isDark={isDark}
              $active={isActive}
              $accent={accent}
              title={
                kpi.hasFilter ? `${kpi.description || kpi.label} (Click to filter table)` : kpi.description || kpi.label
              }
              onClick={() => {
                if (!kpi.hasFilter) return;
                setActiveSheet("requirements");
                setActiveKpiFilter((prev) => (prev === kpi.id ? null : kpi.id));
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: isDark ? "#94a3b8" : "#64748b",
                }}
              >
                {kpi.label}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  width: "100%",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: "JetBrains Mono, monospace",
                    color: accent,
                  }}
                >
                  {kpi.value}
                </span>
                {kpi.sublabel && (
                  <span
                    style={{
                      fontSize: 10.5,
                      color: isDark ? "#64748b" : "#94a3b8",
                    }}
                  >
                    {kpi.sublabel}
                  </span>
                )}
              </div>
            </KpiCard>
          );
        })}
      </KpiRibbon>

      {/* Sheet Switcher & Spreadsheet Actions Toolbar (shown in Tabular & Split modes) */}
      {(mode === "tabular" || mode === "split") && (
        <SubToolbar $isDark={isDark}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            {tabularPayload.availableSheets.map((s) => (
              <PillButton
                key={s.id}
                $isDark={isDark}
                $active={activeSheet === s.id}
                onClick={() => {
                  setActiveSheet(s.id as ActiveSheetId);
                  setEditingCell(null);
                }}
                title={s.description}
              >
                {s.label}
              </PillButton>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {activeSheet !== "matrix" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: isDark ? "#0b1120" : "#ffffff",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                }}
              >
                <SearchIcon size={12} />
                <input
                  type="text"
                  placeholder="Filter requirements…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 11.5,
                    width: 135,
                    color: isDark ? "#e2e8f0" : "#0f172a",
                  }}
                />
              </div>
            )}

            {tabularPayload.capabilities.canInsertRow && (
              <PillButton
                $isDark={isDark}
                onClick={handleAddRow}
                title={
                  activeSheet === "traceability"
                    ? "Insert new SPEC-RELATION link"
                    : "Insert new SPEC-OBJECT requirement"
                }
              >
                <PlusIcon size={12} />
                {activeSheet === "traceability" ? "Add Link" : "Add Requirement"}
              </PillButton>
            )}

            <PillButton
              $isDark={isDark}
              $active={denseMode}
              onClick={() => setDenseMode((d) => !d)}
              title="Toggle compact row density"
            >
              Dense
            </PillButton>

            <PillButton
              $isDark={isDark}
              onClick={() => handleCopyCsvOrTsv("csv")}
              title="Copy current sheet as RFC 4180 CSV"
            >
              {copiedFeedback === "CSV" ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {copiedFeedback === "CSV" ? "Copied CSV" : "CSV"}
            </PillButton>

            <PillButton
              $isDark={isDark}
              onClick={handleDownloadReqIf}
              title="Download updated OMG ReqIF 1.2 (.reqif) file"
            >
              <DownloadIcon size={12} />
              .reqif
            </PillButton>

            {undoStack.length > 0 && (
              <PillButton $isDark={isDark} onClick={handleUndo} title="Undo last tabular edit">
                Undo ({undoStack.length})
              </PillButton>
            )}

            {isEdited && (
              <PillButton $isDark={isDark} onClick={handleReset} title="Reset all tabular edits to original ReqIF XML">
                Reset
              </PillButton>
            )}

            <PillButton
              $isDark={isDark}
              onClick={handleOpenInPlayground}
              title="Open in ModelScript Polyglot Playground"
            >
              Playground
            </PillButton>
          </div>
        </SubToolbar>
      )}

      {/* Main Content Area */}
      {mode === "tabular" && renderTabularPane()}
      {mode === "diagram" && renderDiagramPane()}
      {mode === "code" && renderCodePane()}
      {mode === "split" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              borderRight: `1px solid ${isDark ? "#1e293b" : "#e2e8f0"}`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {renderTabularPane()}
          </div>
          <div style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>{renderCodePane()}</div>
        </div>
      )}
    </Container>
  );
};

export default ReqifViewer;
