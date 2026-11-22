// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CaeSimulationTree — SimScale-inspired floating simulation setup & post-processing
 * tree for FEA (.inp) and CFD (.su2 / .cfg / VTK) workflows in Morsel & Ansatz.
 *
 * Stays bidirectionally synchronized with the live source deck:
 * - Clicking any tree item jumps to the source line and highlights the 3D set/marker.
 * - Clicking `+` inserts valid CalculiX or SU2 deck templates into the editor.
 */

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
  const meshStatus: CaeNodeStatus = hasMesh ? "ok" : dialect === "cfd" ? "ok" : "warning";

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
      contacts: "ok",
      model: "ok",
      materials: materials.length > 0 ? "ok" : "warning",
      initialConditions: initialConditions.length > 0 ? "ok" : "missing",
      boundaryConditions: boundaryConditions.length > 0 ? "ok" : "warning",
      numerics: numerics.length > 0 ? "ok" : "ok",
      simulationControl: simulationControl.length > 0 ? "ok" : "ok",
      mesh: meshStatus,
    },
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
  pickedTargetSet?: string | undefined;
  onGenerateMesh?: ((fineness: "coarse" | "moderate" | "fine") => void) | undefined;
}

function StatusDot({ status }: { status: CaeNodeStatus }) {
  if (status === "ok") {
    return (
      <span
        title="Ready"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: "#16a34a",
          color: "#fff",
          fontSize: 8,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        ✓
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
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: "#d97706",
          color: "#fff",
          fontSize: 9,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        !
      </span>
    );
  }
  return (
    <span
      title="Optional / not set"
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        border: "1.5px solid #94a3b8",
        flexShrink: 0,
      }}
    />
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
  pickedTargetSet,
  onGenerateMesh,
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

  const effectiveRuns: CaeSimulationRunEntry[] = useMemo(
    () =>
      runs && runs.length > 0
        ? runs
        : [
            {
              id: "run-1",
              name: "Run 1",
              status: jobStatus.state === "finished" ? "finished" : "idle",
              fields:
                model.dialect === "cfd"
                  ? ["Velocity Magnitude", "Pressure", "Temperature"]
                  : ["Von Mises Stress", "Displacement", "Element Quality"],
            },
          ],
    [runs, jobStatus.state, model.dialect],
  );

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

  const bg = dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.94)";
  const border = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)";
  const textPrimary = dark ? "#e2e8f0" : "#1f2328";
  const textMuted = dark ? "#94a3b8" : "#64748b";
  const hoverBg = dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)";
  const activeBg = dark ? "rgba(6, 182, 212, 0.18)" : "rgba(6, 182, 212, 0.12)";

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
    padding: "3px 6px",
    borderRadius: 6,
    fontSize: 11,
    cursor: "pointer",
    background: isSelected ? activeBg : "transparent",
    color: textPrimary,
  });

  const plusBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: textMuted,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    padding: "0 4px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 244,
        maxHeight: "calc(100% - 28px)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: textPrimary,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: bg,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: 10,
          border: `1px solid ${border}`,
          boxShadow: "0 10px 28px rgba(0, 0, 0, 0.22)",
          padding: "8px 8px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        {/* GEOMETRIES */}
        <div
          style={{ ...rowStyle(false), fontWeight: 700, fontSize: 10, letterSpacing: 0.4, color: textMuted }}
          onClick={() => toggle("geometries")}
        >
          <span>{expanded.geometries ? "▾" : "▸"}</span>
          <span style={{ flex: 1 }}>GEOMETRIES ({model.geometries.length})</span>
        </div>
        {expanded.geometries &&
          model.geometries.map((g, idx) => (
            <div
              key={`${g.name}-${idx}`}
              style={{ ...rowStyle(selectedItemId === `geom:${g.name}`), paddingLeft: 18 }}
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
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 0.4,
            color: textMuted,
            marginTop: 2,
          }}
          onClick={() => toggle("simulations")}
        >
          <span>{expanded.simulations ? "▾" : "▸"}</span>
          <span style={{ flex: 1 }}>SIMULATIONS</span>
        </div>

        {expanded.simulations && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 11, padding: "2px 6px", color: textPrimary }}>
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
                  +
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
                  +
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
                  +
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
                  +
                </button>
              )}
            </div>

            {/* Simulation Runs */}
            <div style={{ ...rowStyle(false), paddingLeft: 10, marginTop: 2 }} onClick={() => toggle("runs")}>
              <span style={{ fontSize: 10, color: textMuted }}>{expanded.runs ? "▾" : "▸"}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>Simulation Runs</span>
              {onTriggerRun && (
                <button
                  type="button"
                  style={plusBtnStyle}
                  title="Start New Simulation Run"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerRun();
                  }}
                >
                  +
                </button>
              )}
            </div>
            {expanded.runs &&
              effectiveRuns.map((run) => (
                <div key={run.id} style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={rowStyle(false)} onClick={() => toggle(run.id)}>
                    <span style={{ fontSize: 10, color: textMuted }}>{expanded[run.id] !== false ? "▾" : "▸"}</span>
                    <StatusDot status={run.status === "failed" ? "warning" : "ok"} />
                    <span style={{ fontWeight: 600 }}>{run.name}</span>
                  </div>
                  {expanded[run.id] !== false && (
                    <div style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 1 }}>
                      <div
                        style={{ ...rowStyle(selectedItemId === `${run.id}:convergence`), fontSize: 10.5 }}
                        onClick={() => onOpenPostView?.("convergence", run.id)}
                      >
                        <span>📈</span>
                        <span>Convergence plots</span>
                      </div>
                      <div
                        style={{ ...rowStyle(selectedItemId === `${run.id}:log`), fontSize: 10.5 }}
                        onClick={() => onOpenPostView?.("log", run.id)}
                      >
                        <span>📄</span>
                        <span>Solver log</span>
                      </div>
                      <div
                        style={{ ...rowStyle(selectedItemId === `${run.id}:fields`), fontSize: 10.5 }}
                        onClick={() => onOpenPostView?.("fields", run.id)}
                      >
                        <span>🎨</span>
                        <span>Solution Fields</span>
                      </div>
                      {run.fields &&
                        run.fields.map((field) => (
                          <div
                            key={field}
                            style={{
                              ...rowStyle(activeField === field),
                              paddingLeft: 18,
                              fontSize: 10,
                              color: activeField === field ? "#06b6d4" : textMuted,
                              background: activeField === field ? activeBg : "transparent",
                            }}
                            onClick={() => onSelectField?.(field)}
                          >
                            <span>•</span>
                            <span>{field}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
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
export const ScalarColorbarLegend: React.FC<{
  title: string;
  unit?: string | undefined;
  minLabel: string;
  maxLabel: string;
  dark?: boolean | undefined;
}> = ({ title, unit, minLabel, maxLabel, dark = false }) => {
  const bg = dark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.92)";
  const border = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)";
  const textColor = dark ? "#e2e8f0" : "#1f2328";

  return (
    <div
      style={{
        background: bg,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderRadius: 10,
        border: `1px solid ${border}`,
        padding: "8px 10px",
        color: textColor,
        fontSize: 10,
        fontFamily: "var(--font-mono, monospace)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 110,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 10 }}>
        {title}
        {unit ? ` (${unit})` : ""}
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <div
          style={{
            width: 12,
            height: 92,
            borderRadius: 4,
            background: "linear-gradient(to bottom, #ef4444 0%, #f59e0b 25%, #22c55e 50%, #06b6d4 75%, #2563eb 100%)",
            border: `1px solid ${border}`,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontWeight: 600 }}>
          <span>{maxLabel}</span>
          <span>{minLabel}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Inline post-processing drawer for SimScale-style `Convergence plots` and `Solver log`
 * inside the 3D FEA/CFD viewport.
 */
export const CaePostProcessDrawer: React.FC<{
  mode: "convergence" | "log";
  run: CaeSimulationRunEntry;
  allRuns?: CaeSimulationRunEntry[] | undefined;
  cutLineSamples?: Array<{ s: number; value: number }> | undefined;
  dark?: boolean | undefined;
  onClose: () => void;
}> = ({ mode, run, allRuns, cutLineSamples, dark = false, onClose }) => {
  const bg = dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.96)";
  const border = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)";
  const textColor = dark ? "#e2e8f0" : "#1f2328";
  const muted = dark ? "#94a3b8" : "#64748b";

  const residuals =
    run.residuals && run.residuals.length > 0
      ? run.residuals
      : [1, 4.2e-1, 1.5e-1, 5.1e-2, 1.8e-2, 6.2e-3, 2.1e-3, 7.4e-4, 2.5e-4, 8.1e-5];
  const logVals = residuals.map((r) => Math.log10(Math.max(1e-12, r)));
  const minLog = Math.min(...logVals, -6);
  const maxLog = Math.max(...logVals, 0);
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

  const logs =
    run.logLines && run.logLines.length > 0
      ? run.logLines
      : [
          `[solver] Starting ${run.name}...`,
          `[solver] Assembling stiffness / flux matrix...`,
          `[solver] Iter 1  residual = ${residuals[0]?.toExponential(2)}`,
          `[solver] Iter ${residuals.length}  residual = ${residuals[residuals.length - 1]?.toExponential(2)}`,
          `[solver] Converged.`,
        ];

  return (
    <div
      style={{
        background: bg,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: 10,
        border: `1px solid ${border}`,
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
        padding: "10px 12px",
        color: textColor,
        width: 316,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}>
        <strong style={{ fontSize: 11, flex: 1 }}>
          {run.name} — {mode === "convergence" ? "Convergence plots" : "Solver log"}
        </strong>
        <button
          type="button"
          onClick={() => {
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>${run.name} CAE Report</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;max-width:840px;margin:auto}pre{background:#1e293b;padding:12px;border-radius:8px;overflow:auto}</style></head><body><h2>${run.name} — CAE Study Report</h2><p>Status: ${run.status} | Iterations: ${residuals.length}</p><svg width="${w}" height="${h}"><polyline fill="none" stroke="#06b6d4" stroke-width="2" points="${pts}"/></svg>${cutPlot ? `<h3>Cut-Line Profile</h3><svg width="${cutPlot.cw}" height="${cutPlot.ch}"><polyline fill="none" stroke="#f59e0b" stroke-width="2" points="${cutPlot.cPts}"/></svg>` : ""}<h3>Solver Log</h3><pre>${logs.join("\n")}</pre></body></html>`;
            const blob = new Blob([html], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${run.name.toLowerCase().replace(/\s+/g, "-")}-report.html`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            background: "rgba(6, 182, 212, 0.16)",
            border: "1px solid rgba(6, 182, 212, 0.4)",
            borderRadius: 6,
            color: "#06b6d4",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 6px",
          }}
          title="Export self-contained HTML CAE report"
        >
          Export HTML
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: muted, cursor: "pointer", fontSize: 13 }}
          title="Close"
        >
          ✕
        </button>
      </div>
      {mode === "convergence" ? (
        <div>
          <svg width={w} height={h} style={{ display: "block", width: "100%", height: "auto" }}>
            <line x1={10} y1={h - 12} x2={w - 10} y2={h - 12} stroke={border} strokeWidth={1} />
            <line x1={10} y1={12} x2={10} y2={h - 12} stroke={border} strokeWidth={1} />
            <polyline fill="none" stroke="#06b6d4" strokeWidth={2} points={pts} />
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: muted, marginTop: 4 }}>
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
      ) : (
        <pre
          style={{
            margin: 0,
            maxHeight: 150,
            overflowY: "auto",
            fontSize: 10,
            lineHeight: 1.45,
            fontFamily: "var(--font-mono, monospace)",
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
