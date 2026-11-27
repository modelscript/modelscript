// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CaeSimulationTree — SimScale-inspired floating simulation setup & post-processing
 * tree for FEA (.inp) and CFD (.su2 / .cfg / VTK) workflows in Ansatz & Ansatz.
 *
 * Stays bidirectionally synchronized with the live source deck:
 * - Clicking any tree item jumps to the source line and highlights the 3D set/marker.
 * - Clicking `+` inserts valid CalculiX or SU2 deck templates into the editor.
 */

import {
  AlertFillIcon,
  CheckCircleFillIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CloudIcon,
  GraphIcon,
  PlayIcon,
  PlusIcon,
  TerminalIcon,
  VersionsIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useMemo, useState } from "react";

export type CaeNodeStatus = "ok" | "warning" | "missing";

export interface CaeTreeItemRef {
  id: string;
  label: string;
  detail?: string | undefined;
  line: number;
  targetSet?: string | undefined;
  status?: CaeNodeStatus | undefined;
}

export interface CaeGeometryEntry {
  name: string;
  watertight?: boolean | undefined;
  faces?: number | undefined;
  line?: number | undefined;
}

export interface CaeSimulationRunEntry {
  id: string;
  name: string;
  status: "finished" | "running" | "failed" | "idle";
  iterations?: number | undefined;
  residuals?: number[] | undefined;
  logLines?: string[] | undefined;
  fields?: string[] | undefined;
}

export interface CaeSimulationModel {
  dialect: "fea" | "cfd" | "cad";
  studyTitle: string;
  geometries: CaeGeometryEntry[];
  contacts: CaeTreeItemRef[];
  materials: CaeTreeItemRef[];
  initialConditions: CaeTreeItemRef[];
  boundaryConditions: CaeTreeItemRef[];
  numerics: CaeTreeItemRef[];
  simulationControl: CaeTreeItemRef[];
  mesh: {
    nodeCount: number;
    elementCount: number;
    elementTypes: Record<string, number>;
    line?: number | undefined;
    status: CaeNodeStatus;
  };
  statuses: {
    geometry: CaeNodeStatus;
    contacts: CaeNodeStatus;
    model: CaeNodeStatus;
    materials: CaeNodeStatus;
    initialConditions: CaeNodeStatus;
    boundaryConditions: CaeNodeStatus;
    numerics: CaeNodeStatus;
    simulationControl: CaeNodeStatus;
    mesh: CaeNodeStatus;
  };
}

/**
 * Extracts a structured SimScale-style CAE simulation tree from an FEA (.inp),
 * CFD (.su2 / .cfg), or CAD (.step / .scad) source buffer.
 */
export function buildCaeSimulationModel(code: string, externalGeometries?: CaeGeometryEntry[]): CaeSimulationModel {
  const lines = code.split(/\r?\n/);
  const contacts: CaeTreeItemRef[] = [];
  const materials: CaeTreeItemRef[] = [];
  const initialConditions: CaeTreeItemRef[] = [];
  const boundaryConditions: CaeTreeItemRef[] = [];
  const numerics: CaeTreeItemRef[] = [];
  const simulationControl: CaeTreeItemRef[] = [];

  let nodeCount = 0;
  let elementCount = 0;
  let meshLine: number | undefined;
  const elementTypes: Record<string, number> = {};
  let section: "none" | "node" | "element" | "boundary" | "load" | "ic" = "none";
  let currentElemType = "SOLID";
  let currentSet = "";
  let hasThermal = false;
  let hasStructural = false;
  let hasCfd = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (!t || t.startsWith("**") || t.startsWith("//") || t.startsWith("%")) continue;
    const lineNo = i + 1;

    if (t.startsWith("*")) {
      const upper = t.toUpperCase();
      if (upper.startsWith("*NODE")) {
        section = "node";
        if (meshLine === undefined) meshLine = lineNo;
      } else if (upper.startsWith("*ELEMENT")) {
        section = "element";
        if (meshLine === undefined) meshLine = lineNo;
        currentElemType = /\bTYPE\s*=\s*([A-Za-z0-9_]+)/i.exec(t)?.[1]?.toUpperCase() ?? "ELEM";
      } else if (upper.startsWith("*MATERIAL")) {
        section = "none";
        const name = /\bNAME\s*=\s*([^,\s]+)/i.exec(t)?.[1] ?? `Material_${materials.length + 1}`;
        materials.push({ id: `mat:${name}:${lineNo}`, label: name, line: lineNo, targetSet: name, status: "ok" });
      } else if (upper.startsWith("*CONTACT") || upper.startsWith("*TIE") || upper.startsWith("*SURFACE INTERACTION")) {
        section = "none";
        const name = /\bNAME\s*=\s*([^,\s]+)/i.exec(t)?.[1] ?? t.split(",")[0]!.replaceAll("*", "").trim();
        contacts.push({ id: `contact:${lineNo}`, label: name, line: lineNo, status: "ok" });
      } else if (upper.startsWith("*INITIAL CONDITIONS")) {
        section = "ic";
        const type = /\bTYPE\s*=\s*([^,\s]+)/i.exec(t)?.[1] ?? "FIELD";
        initialConditions.push({ id: `ic:${lineNo}`, label: `Initial ${type}`, line: lineNo, status: "ok" });
      } else if (upper.startsWith("*BOUNDARY")) {
        section = "boundary";
        const set = /\bNSET\s*=\s*([^,\s]+)/i.exec(t)?.[1];
        currentSet = set ?? "";
        boundaryConditions.push({
          id: `bc:${lineNo}`,
          label: set ? `Fixed / Prescribed (${set})` : "Boundary Condition",
          line: lineNo,
          targetSet: set,
          status: "ok",
        });
      } else if (
        upper.startsWith("*CLOAD") ||
        upper.startsWith("*DLOAD") ||
        upper.startsWith("*DSLOAD") ||
        upper.startsWith("*FILM") ||
        upper.startsWith("*RADIATE")
      ) {
        section = "load";
        const kind = t.split(",")[0]!.replaceAll("*", "").trim();
        boundaryConditions.push({
          id: `load:${lineNo}`,
          label: `${kind}`,
          line: lineNo,
          status: "ok",
        });
      } else if (upper.startsWith("*HEAT TRANSFER")) {
        hasThermal = true;
        section = "none";
        simulationControl.push({ id: `ctrl:${lineNo}`, label: "Heat Transfer Step", line: lineNo, status: "ok" });
      } else if (upper.startsWith("*STATIC") || upper.startsWith("*DYNAMIC") || upper.startsWith("*FREQUENCY")) {
        hasStructural = true;
        section = "none";
        const kind = t.split(",")[0]!.replaceAll("*", "").trim();
        simulationControl.push({ id: `ctrl:${lineNo}`, label: `${kind} Step`, line: lineNo, status: "ok" });
      } else if (upper.startsWith("*STEP") || upper.startsWith("*CONTROLS")) {
        section = "none";
        numerics.push({
          id: `num:${lineNo}`,
          label: t.split(",")[0]!.replaceAll("*", "").trim(),
          line: lineNo,
          status: "ok",
        });
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "node" && /^\d+\s*,/.test(t)) {
      nodeCount++;
      continue;
    }
    if (section === "element" && /^\d+\s*,/.test(t)) {
      elementCount++;
      elementTypes[currentElemType] = (elementTypes[currentElemType] ?? 0) + 1;
      continue;
    }
    if ((section === "boundary" || section === "load") && !t.startsWith("*")) {
      const firstToken = t.split(",")[0]?.trim();
      if (firstToken && !/^\d+$/.test(firstToken) && boundaryConditions.length > 0 && !currentSet) {
        const last = boundaryConditions[boundaryConditions.length - 1]!;
        if (!last.targetSet) last.targetSet = firstToken;
      }
      continue;
    }

    // SU2 / CFD directives
    const kv = /^([A-Z0-9_]+)\s*=\s*(.+)$/i.exec(t);
    if (kv) {
      const key = kv[1]!.toUpperCase();
      const val = kv[2]!.trim();
      if (key === "MACH_NUMBER" || key === "REYNOLDS_NUMBER" || key === "FREESTREAM_TEMPERATURE" || key === "AOA") {
        hasCfd = true;
        initialConditions.push({ id: `cfd-ic:${lineNo}`, label: key, detail: val, line: lineNo, status: "ok" });
      } else if (key.startsWith("MARKER_")) {
        hasCfd = true;
        boundaryConditions.push({
          id: `cfd-bc:${lineNo}`,
          label: key,
          detail: val,
          line: lineNo,
          targetSet: val.replace(/[()]/g, "").split(",")[0]?.trim(),
          status: "ok",
        });
      } else if (
        key === "KIND_TURB_MODEL" ||
        key === "SOLVER" ||
        key === "CFL_NUMBER" ||
        key === "CONV_NUM_METHOD_FLOW"
      ) {
        hasCfd = true;
        numerics.push({ id: `cfd-num:${lineNo}`, label: key, detail: val, line: lineNo, status: "ok" });
      } else if (key === "ITER" || key === "TIME_STEP" || key === "EXT_ITER") {
        hasCfd = true;
        simulationControl.push({ id: `cfd-ctrl:${lineNo}`, label: key, detail: val, line: lineNo, status: "ok" });
      } else if (key.startsWith("FLUID_") || key === "VISCOSITY_MODEL") {
        hasCfd = true;
        materials.push({ id: `cfd-mat:${lineNo}`, label: key, detail: val, line: lineNo, status: "ok" });
      }
    }
  }

  const dialect: "fea" | "cfd" | "cad" = hasCfd
    ? "cfd"
    : nodeCount > 0 || elementCount > 0 || materials.length > 0 || boundaryConditions.length > 0
      ? "fea"
      : "cad";

  const studyTitle =
    dialect === "cfd"
      ? "Compressible Flow Analysis"
      : hasThermal
        ? "Thermal Analysis"
        : hasStructural
          ? "Static Structural Analysis"
          : "CAE Simulation Study";

  const geometries: CaeGeometryEntry[] =
    externalGeometries && externalGeometries.length > 0
      ? externalGeometries
      : [{ name: dialect === "cfd" ? "Fluid Domain" : "Solid Body", watertight: true }];

  const hasMesh = nodeCount > 0 && elementCount > 0;
  const meshStatus: CaeNodeStatus = hasMesh ? "ok" : dialect === "cfd" ? "missing" : "warning";

  return {
    dialect,
    studyTitle,
    geometries,
    contacts,
    materials,
    initialConditions,
    boundaryConditions,
    numerics,
    simulationControl,
    mesh: {
      nodeCount,
      elementCount,
      elementTypes,
      line: meshLine,
      status: meshStatus,
    },
    statuses: {
      geometry: geometries.some((g) => g.watertight === false) ? "warning" : "ok",
      contacts: contacts.length > 0 ? "ok" : "missing",
      model: "ok",
      materials: materials.length > 0 ? "ok" : "warning",
      initialConditions: initialConditions.length > 0 ? "ok" : "missing",
      boundaryConditions: boundaryConditions.length > 0 ? "ok" : "warning",
      numerics: numerics.length > 0 ? "ok" : "missing",
      simulationControl: simulationControl.length > 0 ? "ok" : "missing",
      mesh: meshStatus,
    },
  };
}

export interface CaeReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "warning" | "error";
  detail: string;
}

export interface CaeReadinessReport {
  ready: boolean;
  errorCount: number;
  warningCount: number;
  checks: CaeReadinessCheck[];
}

/**
 * Evaluates pre-flight solver readiness for a CAE simulation model (SimScale-style check).
 */
export function evaluateCaeReadiness(model: CaeSimulationModel): CaeReadinessReport {
  const checks: CaeReadinessCheck[] = [];

  // 1. Geometry watertightness
  const nonWatertight = model.geometries.filter((g) => g.watertight === false);
  checks.push({
    id: "geometry",
    label: "Geometry",
    status: nonWatertight.length > 0 ? "warning" : "pass",
    detail:
      nonWatertight.length > 0
        ? `${nonWatertight.length} body has open edges`
        : `${model.geometries.length} watertight ${model.geometries.length === 1 ? "body" : "bodies"}`,
  });

  // 2. Material / Fluid properties
  if (model.dialect === "fea") {
    checks.push({
      id: "materials",
      label: "Materials",
      status: model.materials.length > 0 ? "pass" : "error",
      detail:
        model.materials.length > 0
          ? `${model.materials.length} material${model.materials.length === 1 ? "" : "s"} assigned`
          : "Add at least one *MATERIAL block",
    });
  } else {
    checks.push({
      id: "materials",
      label: "Fluid Properties",
      status: model.materials.length > 0 ? "pass" : "warning",
      detail: model.materials.length > 0 ? "Fluid model configured" : "Using default air (Ideal Gas)",
    });
  }

  // 3. Mesh
  const hasMesh = model.mesh.nodeCount > 0 && model.mesh.elementCount > 0;
  if (model.dialect === "fea") {
    checks.push({
      id: "mesh",
      label: "Volume Mesh",
      status: hasMesh ? "pass" : "error",
      detail: hasMesh
        ? `${model.mesh.nodeCount.toLocaleString()} nodes · ${model.mesh.elementCount.toLocaleString()} elems`
        : "Generate Tet4 mesh or add *NODE/*ELEMENT",
    });
  } else {
    checks.push({
      id: "mesh",
      label: "Fluid Domain",
      status: "pass",
      detail: hasMesh ? `${model.mesh.elementCount.toLocaleString()} elements` : "Auto-voxelized LBM/FVM domain",
    });
  }

  // 4. Boundary conditions & loads
  if (model.dialect === "fea") {
    const hasSupport = model.boundaryConditions.some((b) => b.id.startsWith("bc:"));
    const hasLoad = model.boundaryConditions.some((b) => b.id.startsWith("load:"));
    if (hasSupport && hasLoad) {
      checks.push({
        id: "bcs",
        label: "Supports & Loads",
        status: "pass",
        detail: `${model.boundaryConditions.length} constraints & loads`,
      });
    } else if (!hasSupport && !hasLoad) {
      checks.push({
        id: "bcs",
        label: "Supports & Loads",
        status: "error",
        detail: "Missing *BOUNDARY support and load card",
      });
    } else if (!hasSupport) {
      checks.push({
        id: "bcs",
        label: "Supports & Loads",
        status: "warning",
        detail: "No *BOUNDARY support (rigid-body motion risk)",
      });
    } else {
      checks.push({
        id: "bcs",
        label: "Supports & Loads",
        status: "warning",
        detail: "No external load (*CLOAD / *DSLOAD) defined",
      });
    }
  } else {
    checks.push({
      id: "bcs",
      label: "Boundary Markers",
      status: model.boundaryConditions.length > 0 ? "pass" : "warning",
      detail:
        model.boundaryConditions.length > 0
          ? `${model.boundaryConditions.length} MARKER_* patches`
          : "Using default wind-tunnel boundaries",
    });
  }

  const errorCount = checks.filter((c) => c.status === "error").length;
  const warningCount = checks.filter((c) => c.status === "warning").length;
  return {
    ready: errorCount === 0,
    errorCount,
    warningCount,
    checks,
  };
}

export interface CaeSimulationTreeProps {
  model: CaeSimulationModel;
  runs?: CaeSimulationRunEntry[] | undefined;
  activeField?: string | undefined;
  jobStatus?:
    { state: "idle" | "meshing" | "solving" | "finished" | "error"; label: string; progress?: number } | undefined;
  dark?: boolean | undefined;
  selectedItemId?: string | null | undefined;
  onSelectItem?: ((item: { id: string; line?: number; targetSet?: string }) => void) | undefined;
  onInsertSnippet?:
    ((section: "materials" | "initialConditions" | "boundaryConditions", snippet: string) => void) | undefined;
  onSelectField?: ((field: string) => void) | undefined;
  onOpenPostView?: ((view: "convergence" | "log" | "fields", runId: string) => void) | undefined;
  onTriggerRun?: (() => void) | undefined;
  onTriggerHpcRun?: (() => void) | undefined;
  pickedTargetSet?: string | undefined;
  onGenerateMesh?: ((fineness: "coarse" | "moderate" | "fine") => void) | undefined;
  /** Render flush inside a docked sidebar without outer floating card chrome */
  docked?: boolean | undefined;
}

function StatusDot({ status }: { status: CaeNodeStatus }) {
  if (status === "ok") {
    return (
      <span
        title="Configured"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ms-status-pass-fg, var(--ms-success))",
          flexShrink: 0,
        }}
      >
        <CheckCircleFillIcon size={13} />
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span
        title="Needs configuration"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ms-status-warn-fg, var(--ms-warning))",
          flexShrink: 0,
        }}
      >
        <AlertFillIcon size={13} />
      </span>
    );
  }
  return (
    <span
      title="Optional / not set"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ms-text-3, #64748b)",
        flexShrink: 0,
      }}
    >
      <CircleIcon size={12} />
    </span>
  );
}

/**
 * SimScale-style floating left tree for CAE simulations (GEOMETRIES, SIMULATIONS,
 * Materials, Initial/Boundary Conditions, Numerics, Mesh, Simulation Runs, JOB STATUS).
 */
export const CaeSimulationTree: React.FC<CaeSimulationTreeProps> = ({
  model,
  runs,
  activeField,
  jobStatus = { state: "idle", label: "Ready" },
  dark = false,
  selectedItemId,
  onSelectItem,
  onInsertSnippet,
  onSelectField,
  onOpenPostView,
  onTriggerRun,
  onTriggerHpcRun,
  pickedTargetSet,
  onGenerateMesh,
  docked = false,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    geometries: false,
    simulations: true,
    materials: true,
    ic: false,
    bc: true,
    advanced: false,
    runs: true,
    run1: true,
  });

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const effectiveRuns: CaeSimulationRunEntry[] = useMemo(() => (runs && runs.length > 0 ? runs : []), [runs]);
  const readiness = useMemo(() => evaluateCaeReadiness(model), [model]);
  const [showReadinessDetails, setShowReadinessDetails] = useState(false);

  const [activePopover, setActivePopover] = useState<"materials" | "bc" | "mesh" | null>(null);
  const [selectedMatPreset, setSelectedMatPreset] = useState("Al6061_T6");
  const [selectedBcKind, setSelectedBcKind] = useState("fixed");
  const [bcTargetSet, setBcTargetSet] = useState(pickedTargetSet || "FIX_NODES");
  const [bcMagnitude, setBcMagnitude] = useState("-1000.0");
  const [meshFineness, setMeshFineness] = useState<"coarse" | "moderate" | "fine">("moderate");

  React.useEffect(() => {
    if (pickedTargetSet) {
      setBcTargetSet(pickedTargetSet);
    }
  }, [pickedTargetSet]);

  const bg = "var(--ms-surface-glass, var(--ms-bg))";
  const border = "var(--ms-border, var(--color-border-default))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";
  const hoverBg = "var(--ms-surface-hover, rgba(15, 23, 42, 0.05))";
  const activeBg = "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))";
  const brandFg = "var(--ms-brand, #0e7490)";

  const materialSnippets: Record<string, string> = {
    Al6061_T6: "\n*MATERIAL, NAME=Al6061_T6\n*ELASTIC\n68900.0, 0.33\n*DENSITY\n2.7e-9\n",
    Ti6Al4V: "\n*MATERIAL, NAME=Ti6Al4V\n*ELASTIC\n113800.0, 0.342\n*DENSITY\n4.43e-9\n",
    Steel316L: "\n*MATERIAL, NAME=Steel316L\n*ELASTIC\n193000.0, 0.29\n*DENSITY\n8.0e-9\n",
    ABS_Plastic: "\n*MATERIAL, NAME=ABS_Plastic\n*ELASTIC\n2300.0, 0.35\n*DENSITY\n1.04e-9\n",
    IdealGas: "\nFLUID_MODEL= IDEAL_GAS\nGAMMA_VALUE= 1.4\n",
  };

  const insertMaterial = () => {
    setActivePopover((p) => (p === "materials" ? null : "materials"));
  };

  const commitMaterial = () => {
    const snippet =
      model.dialect === "cfd"
        ? materialSnippets.IdealGas!
        : (materialSnippets[selectedMatPreset] ?? materialSnippets.Al6061_T6!);
    onInsertSnippet?.("materials", snippet);
    setActivePopover(null);
  };

  const insertInitialCondition = () => {
    const snippet =
      model.dialect === "cfd"
        ? "\nMACH_NUMBER= 0.3\nFREESTREAM_TEMPERATURE= 300.0\n"
        : "\n*INITIAL CONDITIONS, TYPE=TEMPERATURE\nNALL, 293.15\n";
    onInsertSnippet?.("initialConditions", snippet);
  };

  const insertBoundaryCondition = () => {
    setActivePopover((p) => (p === "bc" ? null : "bc"));
  };

  const commitBoundaryCondition = () => {
    const target = bcTargetSet.trim() || "FIX_NODES";
    let snippet = "";
    if (model.dialect === "cfd") {
      snippet =
        selectedBcKind === "heatflux"
          ? `\nMARKER_HEATFLUX= ( ${target}, ${bcMagnitude} )\n`
          : `\nMARKER_EULER= ( ${target} )\n`;
    } else if (selectedBcKind === "force") {
      snippet = `\n*CLOAD\n${target}, 2, ${bcMagnitude}\n`;
    } else if (selectedBcKind === "heatflux") {
      snippet = `\n*DFLUX\n${target}, S, ${bcMagnitude}\n`;
    } else {
      snippet = `\n*BOUNDARY\n${target}, 1, 3, 0.0\n`;
    }
    onInsertSnippet?.("boundaryConditions", snippet);
    setActivePopover(null);
  };

  const rowStyle = (isSelected: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: "var(--ms-radius-sm, 6px)",
    fontSize: "var(--text-xs, 12px)",
    cursor: "pointer",
    background: isSelected ? activeBg : "transparent",
    color: isSelected ? brandFg : textPrimary,
    fontWeight: isSelected ? 600 : 400,
  });

  const plusBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    background: "transparent",
    border: "none",
    borderRadius: 5,
    color: textMuted,
    cursor: "pointer",
    padding: 0,
  };

  const hpcBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    background: activeBg,
    border: `1px solid ${border}`,
    borderRadius: 5,
    color: brandFg,
    cursor: "pointer",
    fontSize: "var(--text-2xs, 11px)",
    fontWeight: 600,
    lineHeight: 1.2,
    padding: "2px 6px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: docked ? "100%" : 264,
        maxHeight: docked ? "100%" : "calc(100% - 28px)",
        fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
        color: textPrimary,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: docked ? "transparent" : bg,
          backdropFilter: docked ? undefined : "blur(14px)",
          WebkitBackdropFilter: docked ? undefined : "blur(14px)",
          borderRadius: docked ? 0 : "var(--ms-radius-md, 10px)",
          border: docked ? "none" : `1px solid ${border}`,
          boxShadow: docked ? "none" : "var(--ms-shadow-card, 0 8px 24px rgba(15, 23, 42, 0.14))",
          padding: docked ? "4px 2px" : "8px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {/* GEOMETRIES */}
        <div
          style={{
            ...rowStyle(false),
            fontWeight: 600,
            fontSize: "var(--text-2xs, 11px)",
            letterSpacing: "var(--ms-tracking-wide, 0.04em)",
            color: textMuted,
          }}
          onClick={() => toggle("geometries")}
        >
          {expanded.geometries ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          <span style={{ flex: 1 }}>GEOMETRIES ({model.geometries.length})</span>
        </div>
        {expanded.geometries &&
          model.geometries.map((g, idx) => (
            <div
              key={`${g.name}-${idx}`}
              style={{ ...rowStyle(selectedItemId === `geom:${g.name}`), paddingLeft: 20 }}
              onClick={() => onSelectItem?.({ id: `geom:${g.name}`, line: g.line })}
            >
              <StatusDot status={g.watertight === false ? "warning" : "ok"} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.name}
              </span>
            </div>
          ))}

        {/* SIMULATIONS */}
        <div
          style={{
            ...rowStyle(false),
            fontWeight: 600,
            fontSize: "var(--text-2xs, 11px)",
            letterSpacing: "var(--ms-tracking-wide, 0.04em)",
            color: textMuted,
            marginTop: 4,
          }}
          onClick={() => toggle("simulations")}
        >
          {expanded.simulations ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          <span style={{ flex: 1 }}>SIMULATION SETUP</span>
        </div>

        {expanded.simulations && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 4 }}>
            <div style={{ fontWeight: 600, fontSize: "var(--text-xs, 12px)", padding: "3px 8px", color: textPrimary }}>
              {model.studyTitle}
            </div>

            {/* Geometry */}
            <div
              style={{ ...rowStyle(selectedItemId === "sim:geometry"), paddingLeft: 10 }}
              onClick={() => onSelectItem?.({ id: "sim:geometry", line: model.geometries[0]?.line })}
            >
              <StatusDot status={model.statuses.geometry} />
              <span>Geometry</span>
            </div>

            {/* Contacts */}
            <div style={{ ...rowStyle(selectedItemId === "sim:contacts"), paddingLeft: 10 }}>
              <StatusDot status={model.statuses.contacts} />
              <span style={{ flex: 1 }}>Contacts ({model.contacts.length})</span>
            </div>

            {/* Materials */}
            <div style={{ ...rowStyle(false), paddingLeft: 10 }} onClick={() => toggle("materials")}>
              <StatusDot status={model.statuses.materials} />
              <span style={{ flex: 1 }}>Materials ({model.materials.length})</span>
              {onInsertSnippet && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Add Material"
                  onClick={(e) => {
                    e.stopPropagation();
                    insertMaterial();
                  }}
                >
                  <PlusIcon size={12} />
                </button>
              )}
            </div>
            {expanded.materials &&
              model.materials.map((m) => (
                <div
                  key={m.id}
                  style={{ ...rowStyle(selectedItemId === m.id), paddingLeft: 26, fontSize: 10.5 }}
                  onClick={() => onSelectItem?.({ id: m.id, line: m.line, targetSet: m.targetSet })}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.label}
                    {m.detail ? `: ${m.detail}` : ""}
                  </span>
                </div>
              ))}

            {/* Initial conditions */}
            <div style={{ ...rowStyle(false), paddingLeft: 10 }} onClick={() => toggle("ic")}>
              <StatusDot status={model.statuses.initialConditions} />
              <span style={{ flex: 1 }}>Initial conditions ({model.initialConditions.length})</span>
              {onInsertSnippet && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Add Initial Condition"
                  onClick={(e) => {
                    e.stopPropagation();
                    insertInitialCondition();
                  }}
                >
                  <PlusIcon size={12} />
                </button>
              )}
            </div>
            {expanded.ic &&
              model.initialConditions.map((ic) => (
                <div
                  key={ic.id}
                  style={{ ...rowStyle(selectedItemId === ic.id), paddingLeft: 26, fontSize: 10.5 }}
                  onClick={() => onSelectItem?.({ id: ic.id, line: ic.line, targetSet: ic.targetSet })}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ic.label}
                    {ic.detail ? ` = ${ic.detail}` : ""}
                  </span>
                </div>
              ))}

            {/* Boundary conditions */}
            <div style={{ ...rowStyle(false), paddingLeft: 10 }} onClick={() => toggle("bc")}>
              <StatusDot status={model.statuses.boundaryConditions} />
              <span style={{ flex: 1 }}>Boundary conditions ({model.boundaryConditions.length})</span>
              {onInsertSnippet && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Add Boundary Condition"
                  onClick={(e) => {
                    e.stopPropagation();
                    insertBoundaryCondition();
                  }}
                >
                  <PlusIcon size={12} />
                </button>
              )}
            </div>
            {expanded.bc &&
              model.boundaryConditions.map((bc) => (
                <div
                  key={bc.id}
                  style={{ ...rowStyle(selectedItemId === bc.id), paddingLeft: 26, fontSize: 10.5 }}
                  onClick={() => onSelectItem?.({ id: bc.id, line: bc.line, targetSet: bc.targetSet })}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bc.label}
                    {bc.detail ? `: ${bc.detail}` : ""}
                  </span>
                </div>
              ))}

            {/* Advanced concepts: Numerics & Simulation control */}
            <div style={{ ...rowStyle(false), paddingLeft: 10 }} onClick={() => toggle("advanced")}>
              <span style={{ fontSize: 10, color: textMuted }}>{expanded.advanced ? "▾" : "▸"}</span>
              <span style={{ flex: 1 }}>Advanced concepts</span>
            </div>
            {expanded.advanced && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 22 }}>
                <div
                  style={rowStyle(selectedItemId === "sim:numerics")}
                  onClick={() => onSelectItem?.({ id: "sim:numerics", line: model.numerics[0]?.line })}
                >
                  <StatusDot status={model.statuses.numerics} />
                  <span>Numerics ({model.numerics.length})</span>
                </div>
                <div
                  style={rowStyle(selectedItemId === "sim:control")}
                  onClick={() => onSelectItem?.({ id: "sim:control", line: model.simulationControl[0]?.line })}
                >
                  <StatusDot status={model.statuses.simulationControl} />
                  <span>Simulation control ({model.simulationControl.length})</span>
                </div>
              </div>
            )}

            {/* Mesh */}
            <div
              style={{ ...rowStyle(selectedItemId === "sim:mesh"), paddingLeft: 10 }}
              onClick={() => onSelectItem?.({ id: "sim:mesh", line: model.mesh.line })}
            >
              <StatusDot status={model.statuses.mesh} />
              <span style={{ flex: 1 }}>Mesh {model.mesh.elementCount > 0 ? `(${model.mesh.elementCount})` : ""}</span>
              {onGenerateMesh && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Generate In-Browser Mesh"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopover((p) => (p === "mesh" ? null : "mesh"));
                  }}
                >
                  <PlusIcon size={12} />
                </button>
              )}
            </div>

            {/* Simulation Runs */}
            <div style={{ ...rowStyle(false), paddingLeft: 10, marginTop: 4 }} onClick={() => toggle("runs")}>
              <span style={{ color: textMuted, display: "inline-flex" }}>
                {expanded.runs ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              </span>
              <span style={{ flex: 1, fontWeight: 600 }}>Simulation Runs</span>
              {onTriggerRun && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Run Local Simulation (Browser)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerRun();
                  }}
                >
                  <PlayIcon size={12} />
                </button>
              )}
              {onTriggerHpcRun && (
                <button
                  type="button"
                  style={hpcBtnStyle}
                  title="Dispatch study to Cloud / HPC Cluster"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerHpcRun();
                  }}
                >
                  <CloudIcon size={11} />
                  HPC
                </button>
              )}
            </div>
            {expanded.runs &&
              (effectiveRuns.length === 0 ? (
                <div
                  style={{
                    padding: "6px 12px 6px 24px",
                    fontSize: "var(--text-2xs, 11px)",
                    color: textMuted,
                  }}
                >
                  No runs yet. Start a local run or dispatch to HPC.
                </div>
              ) : (
                effectiveRuns.map((run) => (
                  <div key={run.id} style={{ paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={rowStyle(false)} onClick={() => toggle(run.id)}>
                      <span style={{ color: textMuted, display: "inline-flex" }}>
                        {expanded[run.id] !== false ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                      </span>
                      <StatusDot
                        status={run.status === "finished" ? "ok" : run.status === "failed" ? "warning" : "missing"}
                      />
                      <span style={{ fontWeight: 600 }}>{run.name}</span>
                    </div>
                    {expanded[run.id] !== false && (
                      <div style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div
                          style={{
                            ...rowStyle(selectedItemId === `${run.id}:convergence`),
                            fontSize: "var(--text-xs, 12px)",
                          }}
                          onClick={() => onOpenPostView?.("convergence", run.id)}
                        >
                          <GraphIcon size={13} />
                          <span>Convergence plots</span>
                        </div>
                        <div
                          style={{ ...rowStyle(selectedItemId === `${run.id}:log`), fontSize: "var(--text-xs, 12px)" }}
                          onClick={() => onOpenPostView?.("log", run.id)}
                        >
                          <TerminalIcon size={13} />
                          <span>Solver log</span>
                        </div>
                        <div
                          style={{
                            ...rowStyle(selectedItemId === `${run.id}:fields`),
                            fontSize: "var(--text-xs, 12px)",
                          }}
                          onClick={() => onOpenPostView?.("fields", run.id)}
                        >
                          <VersionsIcon size={13} />
                          <span>Solution fields</span>
                        </div>
                        {run.fields &&
                          run.fields.map((field) => (
                            <div
                              key={field}
                              style={{
                                ...rowStyle(activeField === field),
                                paddingLeft: 20,
                                fontSize: "var(--text-2xs, 11px)",
                                color: activeField === field ? brandFg : textMuted,
                                background: activeField === field ? activeBg : "transparent",
                              }}
                              onClick={() => onSelectField?.(field)}
                            >
                              <span>{field}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))
              ))}
          </div>
        )}
      </div>

      {/* Quick-Insert Popover for Materials & Boundary Conditions */}
      {activePopover && (
        <div
          style={{
            background: bg,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 10,
            border: `1px solid ${border}`,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700 }}>
            <span>
              {activePopover === "materials"
                ? "Add Material"
                : activePopover === "mesh"
                  ? "Generate Tet4 Mesh"
                  : "Add Boundary Condition"}
            </span>
            <button
              type="button"
              onClick={() => setActivePopover(null)}
              style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          {activePopover === "mesh" ? (
            <>
              <select
                value={meshFineness}
                onChange={(e) => setMeshFineness(e.target.value as "coarse" | "moderate" | "fine")}
                style={{
                  fontSize: 11,
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: dark ? "#0f172a" : "#ffffff",
                  color: textPrimary,
                  border: `1px solid ${border}`,
                }}
              >
                <option value="coarse">Coarse (Fast Tet4)</option>
                <option value="moderate">Moderate (Balanced Tet4)</option>
                <option value="fine">Fine (High-Resolution Tet4)</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  onGenerateMesh?.(meshFineness);
                  setActivePopover(null);
                }}
                style={{
                  background: "#06b6d4",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Generate Mesh
              </button>
            </>
          ) : activePopover === "materials" ? (
            <>
              <select
                value={selectedMatPreset}
                onChange={(e) => setSelectedMatPreset(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: dark ? "#0f172a" : "#ffffff",
                  color: textPrimary,
                  border: `1px solid ${border}`,
                }}
              >
                <option value="Al6061_T6">Aluminum 6061-T6 (68.9 GPa)</option>
                <option value="Ti6Al4V">Titanium Ti-6Al-4V (113.8 GPa)</option>
                <option value="Steel316L">Stainless Steel 316L (193 GPa)</option>
                <option value="ABS_Plastic">ABS Plastic (2.3 GPa)</option>
                <option value="IdealGas">Ideal Gas (Air, γ=1.4)</option>
              </select>
              <button
                type="button"
                onClick={commitMaterial}
                style={{
                  background: "#06b6d4",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Insert Material
              </button>
            </>
          ) : (
            <>
              <select
                value={selectedBcKind}
                onChange={(e) => setSelectedBcKind(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: dark ? "#0f172a" : "#ffffff",
                  color: textPrimary,
                  border: `1px solid ${border}`,
                }}
              >
                <option value="fixed">Fixed Support (*BOUNDARY / EULER)</option>
                <option value="force">Force Load (*CLOAD)</option>
                <option value="heatflux">Heat Flux (*DFLUX / HEATFLUX)</option>
              </select>
              <input
                type="text"
                value={bcTargetSet}
                onChange={(e) => setBcTargetSet(e.target.value)}
                placeholder="Target Set / Marker (e.g. FIX_NODES)"
                style={{
                  fontSize: 11,
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: dark ? "#0f172a" : "#ffffff",
                  color: textPrimary,
                  border: `1px solid ${border}`,
                }}
              />
              {selectedBcKind !== "fixed" && (
                <input
                  type="text"
                  value={bcMagnitude}
                  onChange={(e) => setBcMagnitude(e.target.value)}
                  placeholder="Magnitude (e.g. -1000.0)"
                  style={{
                    fontSize: 11,
                    padding: "3px 6px",
                    borderRadius: 6,
                    background: dark ? "#0f172a" : "#ffffff",
                    color: textPrimary,
                    border: `1px solid ${border}`,
                  }}
                />
              )}
              <button
                type="button"
                onClick={commitBoundaryCondition}
                style={{
                  background: "#06b6d4",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Insert Boundary Condition
              </button>
            </>
          )}
        </div>
      )}

      {/* Pre-Flight Readiness Summary */}
      <div
        data-testid="cae-readiness-card"
        style={{
          background:
            readiness.errorCount > 0
              ? "var(--ms-status-fail-bg)"
              : readiness.warningCount > 0
                ? "var(--ms-status-warn-bg)"
                : "var(--ms-status-pass-bg)",
          border: `1px solid ${
            readiness.errorCount > 0
              ? "var(--ms-status-fail-border)"
              : readiness.warningCount > 0
                ? "var(--ms-status-warn-border)"
                : "var(--ms-status-pass-border)"
          }`,
          borderRadius: "var(--ms-radius-sm, 6px)",
          padding: "6px 8px",
          fontSize: "var(--text-2xs, 11px)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontWeight: 600,
            color:
              readiness.errorCount > 0
                ? "var(--ms-status-fail-fg)"
                : readiness.warningCount > 0
                  ? "var(--ms-status-warn-fg)"
                  : "var(--ms-status-pass-fg)",
          }}
          onClick={() => setShowReadinessDetails((v) => !v)}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {readiness.ready ? <CheckCircleFillIcon size={12} /> : <AlertFillIcon size={12} />}
            {readiness.errorCount > 0
              ? `${readiness.errorCount} setup ${readiness.errorCount === 1 ? "issue" : "issues"}`
              : readiness.warningCount > 0
                ? `Ready (${readiness.warningCount} ${readiness.warningCount === 1 ? "warning" : "warnings"})`
                : "Pre-flight ready"}
          </span>
          {showReadinessDetails ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </div>
        {showReadinessDetails && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 2 }}>
            {readiness.checks.map((chk) => (
              <div
                key={chk.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 6,
                  color: textPrimary,
                  fontSize: "var(--text-2xs, 11px)",
                }}
              >
                <span style={{ fontWeight: 600 }}>{chk.label}</span>
                <span style={{ color: textMuted, textAlign: "right" }}>{chk.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* JOB STATUS Pill */}
      <div
        style={{
          background: bg,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: 10,
          border: `1px solid ${border}`,
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.2)",
          padding: "7px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: textMuted }}>JOB STATUS</span>
          <span
            style={{
              color:
                jobStatus.state === "finished"
                  ? "#16a34a"
                  : jobStatus.state === "error"
                    ? "#ef4444"
                    : jobStatus.state === "solving" || jobStatus.state === "meshing"
                      ? "#06b6d4"
                      : textPrimary,
            }}
          >
            {jobStatus.label}
          </span>
        </div>
        {(jobStatus.state === "meshing" || jobStatus.state === "solving") && (
          <div style={{ height: 3, borderRadius: 2, background: hoverBg, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.round((jobStatus.progress ?? 0.5) * 100)}%`,
                background: "#06b6d4",
                transition: "width 0.2s ease",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Floating scalar colorbar legend for FEA/CFD contour fields (Von Mises, Temperature, Velocity, Pressure).
 */
const COLORMAP_GRADIENTS: Record<"turbo" | "viridis" | "plasma" | "coolwarm", string> = {
  turbo:
    "linear-gradient(to top, #30123b 0%, #466be3 20%, #1ac7b8 40%, #a3ee3d 60%, #fca624 80%, #d63310 92%, #7a0403 100%)",
  viridis:
    "linear-gradient(to top, #440154 0%, #482878 20%, #31688e 40%, #21918c 60%, #35b779 78%, #90d743 90%, #fde725 100%)",
  plasma:
    "linear-gradient(to top, #0d0887 0%, #5302a3 20%, #8b0aa5 40%, #b83289 60%, #db5c68 78%, #f48849 90%, #f0f921 100%)",
  coolwarm:
    "linear-gradient(to top, #3b4cc0 0%, #7092f5 25%, #b4cdfc 45%, #dedede 50%, #f5b799 65%, #e06b54 85%, #b40426 100%)",
};

export const ScalarColorbarLegend: React.FC<{
  title: string;
  unit?: string | undefined;
  minLabel: string;
  maxLabel: string;
  dark?: boolean | undefined;
  colormap?: "turbo" | "viridis" | "plasma" | "coolwarm" | undefined;
  onChangeColormap?: ((next: "turbo" | "viridis" | "plasma" | "coolwarm") => void) | undefined;
  logScale?: boolean | undefined;
  onToggleLogScale?: (() => void) | undefined;
  fieldSummary?: { areaWeightedMean: number; surfaceIntegral: number; totalArea: number } | null | undefined;
}> = ({
  title,
  unit,
  minLabel,
  maxLabel,
  colormap = "turbo",
  onChangeColormap,
  logScale = false,
  onToggleLogScale,
  fieldSummary,
}) => {
  const interactive = Boolean(onChangeColormap || onToggleLogScale);
  return (
    <div
      style={{
        background: "var(--ms-surface-glass, var(--ms-bg))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "var(--ms-radius-md, 10px)",
        border: "1px solid var(--ms-border, var(--color-border-default))",
        boxShadow: "var(--ms-shadow-card)",
        padding: "8px 10px",
        color: "var(--ms-text-1, var(--color-fg-default))",
        fontSize: "var(--text-2xs, 11px)",
        fontFamily: "var(--ms-font-mono, monospace)",
        fontVariantNumeric: "tabular-nums",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 148,
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      <div style={{ fontWeight: 600, fontFamily: "var(--ms-font-sans, system-ui, sans-serif)" }}>
        {title}
        {unit ? ` (${unit})` : ""}
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <div
          style={{
            width: 12,
            height: 96,
            borderRadius: 4,
            background: COLORMAP_GRADIENTS[colormap] ?? COLORMAP_GRADIENTS.turbo,
            border: "1px solid var(--ms-border)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontWeight: 600 }}>
          <span>{maxLabel}</span>
          {fieldSummary && (
            <span style={{ fontWeight: 400, color: "var(--ms-text-2)" }}>
              μ {fieldSummary.areaWeightedMean.toPrecision(3)}
            </span>
          )}
          <span>{minLabel}</span>
        </div>
      </div>
      {fieldSummary && fieldSummary.totalArea > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--ms-divider)",
            paddingTop: 4,
            color: "var(--ms-text-2)",
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
          title="Surface integral ∫φ dA over outer boundary"
        >
          <span>∫dA</span>
          <span style={{ color: "var(--ms-text-1)" }}>{fieldSummary.surfaceIntegral.toExponential(2)}</span>
        </div>
      )}
      {interactive && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 2 }}>
          {onChangeColormap && (
            <select
              aria-label="Colormap"
              value={colormap}
              onChange={(e) => onChangeColormap(e.target.value as "turbo" | "viridis" | "plasma" | "coolwarm")}
              style={{
                flex: 1,
                fontSize: "var(--text-2xs, 11px)",
                fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
                background: "var(--ms-bg)",
                color: "var(--ms-text-1)",
                border: "1px solid var(--ms-border)",
                borderRadius: 4,
                padding: "2px 4px",
                cursor: "pointer",
              }}
            >
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
              <option value="plasma">Plasma</option>
              <option value="coolwarm">Coolwarm</option>
            </select>
          )}
          {onToggleLogScale && (
            <button
              type="button"
              onClick={onToggleLogScale}
              style={{
                fontSize: "var(--text-2xs, 11px)",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid var(--ms-border)",
                background: logScale ? "var(--ms-brand-soft)" : "var(--ms-bg-alt)",
                color: logScale ? "var(--ms-brand)" : "var(--ms-text-2)",
                cursor: "pointer",
              }}
              title="Toggle linear / logarithmic scalar color mapping"
            >
              {logScale ? "Log" : "Lin"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Inline post-processing drawer for Convergence plots and Solver log.
 */
export const CaePostProcessDrawer: React.FC<{
  mode: "convergence" | "log";
  run: CaeSimulationRunEntry;
  allRuns?: CaeSimulationRunEntry[] | undefined;
  cutLineSamples?: Array<{ s: number; value: number }> | undefined;
  dark?: boolean | undefined;
  onClose: () => void;
}> = ({ mode, run, allRuns, cutLineSamples, onClose }) => {
  const bg = "var(--ms-surface-glass, var(--ms-bg))";
  const border = "var(--ms-border, var(--color-border-default))";
  const textColor = "var(--ms-text-1, var(--color-fg-default))";
  const muted = "var(--ms-text-2, var(--color-fg-muted))";

  const residuals = run.residuals && run.residuals.length > 0 ? run.residuals : [];
  const logVals = residuals.map((r) => Math.log10(Math.max(1e-12, r)));
  const minLog = logVals.length > 0 ? Math.min(...logVals, -6) : -6;
  const maxLog = logVals.length > 0 ? Math.max(...logVals, 0) : 0;
  const span = Math.max(1e-6, maxLog - minLog);
  const w = 280;
  const h = 110;
  const pts = logVals
    .map((v, idx) => {
      const x = residuals.length > 1 ? (idx / (residuals.length - 1)) * (w - 20) + 10 : w / 2;
      const y = h - 12 - ((v - minLog) / span) * (h - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const cutPlot = (() => {
    if (!cutLineSamples || cutLineSamples.length < 2) return null;
    const minV = Math.min(...cutLineSamples.map((p) => p.value));
    const maxV = Math.max(...cutLineSamples.map((p) => p.value));
    const vSpan = Math.max(1e-6, maxV - minV);
    const cw = 280;
    const ch = 72;
    const cPts = cutLineSamples
      .map((p) => {
        const x = 10 + p.s * (cw - 20);
        const y = ch - 10 - ((p.value - minV) / vSpan) * (ch - 20);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { minV, maxV, cw, ch, cPts };
  })();

  const logs = run.logLines && run.logLines.length > 0 ? run.logLines : [];

  return (
    <div
      style={{
        background: bg,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderRadius: "var(--ms-radius-md, 10px)",
        border: `1px solid ${border}`,
        boxShadow: "var(--ms-shadow-pop, 0 12px 28px rgba(15, 23, 42, 0.2))",
        padding: "12px 14px",
        color: textColor,
        fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
        fontSize: "var(--text-xs, 12px)",
        width: 332,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}>
        <strong style={{ fontSize: "12px", fontWeight: 600, flex: 1 }}>
          {run.name} — {mode === "convergence" ? "Convergence plots" : "Solver log"}
        </strong>
        <button
          type="button"
          onClick={() => {
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>${run.name} CAE Report</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;max-width:840px;margin:auto}pre{background:#1e293b;padding:12px;border-radius:8px;overflow:auto}</style></head><body><h2>${run.name} — CAE Study Report</h2><p>Status: ${run.status} | Iterations: ${residuals.length}</p><svg width="${w}" height="${h}"><polyline fill="none" stroke="#0891b2" stroke-width="2" points="${pts}"/></svg>${cutPlot ? `<h3>Cut-Line Profile</h3><svg width="${cutPlot.cw}" height="${cutPlot.ch}"><polyline fill="none" stroke="#d97706" stroke-width="2" points="${cutPlot.cPts}"/></svg>` : ""}<h3>Solver Log</h3><pre>${logs.join("\n")}</pre></body></html>`;
            const blob = new Blob([html], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${run.name.toLowerCase().replace(/\s+/g, "-")}-report.html`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            background: "var(--ms-brand-soft)",
            border: "1px solid var(--ms-border)",
            borderRadius: "var(--ms-radius-sm, 6px)",
            color: "var(--ms-brand, #0e7490)",
            cursor: "pointer",
            fontSize: "var(--text-2xs, 11px)",
            fontWeight: 600,
            padding: "3px 8px",
          }}
          title="Export self-contained HTML CAE report"
        >
          Export HTML
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close post-process drawer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            background: "transparent",
            border: "none",
            borderRadius: "var(--ms-radius-sm, 6px)",
            color: muted,
            cursor: "pointer",
          }}
          title="Close"
        >
          <XIcon size={14} />
        </button>
      </div>
      {mode === "convergence" ? (
        residuals.length === 0 ? (
          <div style={{ padding: "12px 0", color: muted, fontSize: "var(--text-xs, 12px)" }}>
            No residual history recorded for this run yet.
          </div>
        ) : (
          <div>
            <svg width={w} height={h} style={{ display: "block", width: "100%", height: "auto" }}>
              <line x1={10} y1={h - 12} x2={w - 10} y2={h - 12} stroke={border} strokeWidth={1} />
              <line x1={10} y1={12} x2={10} y2={h - 12} stroke={border} strokeWidth={1} />
              <polyline fill="none" stroke="var(--ms-brand, #0e7490)" strokeWidth={2} points={pts} />
            </svg>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "var(--text-2xs, 11px)",
                fontFamily: "var(--ms-font-mono, monospace)",
                color: muted,
                marginTop: 4,
              }}
            >
              <span>
                log₁₀(R): {maxLog.toFixed(1)} → {minLog.toFixed(1)}
              </span>
              <span>{residuals.length} iters</span>
            </div>
            {cutPlot && (
              <div style={{ marginTop: 8, borderTop: `1px solid ${border}`, paddingTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, color: muted }}>
                  Cut-Line Profile (X-Axis)
                </div>
                <svg width={cutPlot.cw} height={cutPlot.ch} style={{ display: "block", width: "100%", height: "auto" }}>
                  <line
                    x1={10}
                    y1={cutPlot.ch - 10}
                    x2={cutPlot.cw - 10}
                    y2={cutPlot.ch - 10}
                    stroke={border}
                    strokeWidth={1}
                  />
                  <polyline fill="none" stroke="#f59e0b" strokeWidth={2} points={cutPlot.cPts} />
                </svg>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: muted }}>
                  <span>min: {cutPlot.minV.toFixed(2)}</span>
                  <span>max: {cutPlot.maxV.toFixed(2)}</span>
                </div>
              </div>
            )}
            {allRuns && allRuns.length > 1 && (
              <div style={{ marginTop: 8, borderTop: `1px solid ${border}`, paddingTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, color: muted }}>Run Comparison</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10 }}>
                  {allRuns.map((r) => {
                    const rLast = r.residuals?.[r.residuals.length - 1];
                    return (
                      <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: r.id === run.id ? 700 : 400 }}>{r.name}</span>
                        <span style={{ color: muted }}>{r.status}</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {rLast !== undefined ? rLast.toExponential(1) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )
      ) : logs.length === 0 ? (
        <div style={{ padding: "12px 0", color: muted, fontSize: "var(--text-xs, 12px)" }}>
          No solver output recorded for this run yet.
        </div>
      ) : (
        <pre
          style={{
            margin: 0,
            maxHeight: 160,
            overflowY: "auto",
            fontSize: "var(--text-2xs, 11px)",
            lineHeight: 1.45,
            fontFamily: "var(--ms-font-mono, monospace)",
            color: textColor,
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
};
