// SPDX-License-Identifier: AGPL-3.0-or-later

import { LockIcon, XIcon } from "@primer/octicons-react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type React from "react";
import { useMemo, useState } from "react";
import * as THREE from "three";
import type { ProbeData } from "./ProbeTooltip";

export type FeaBoundaryKind =
  "fixed_support" | "force_load" | "pressure_load" | "prescribed_displacement" | "stress_probe" | "face_tag";

export type CfdBoundaryKind =
  "fluid_inlet" | "fluid_outlet" | "wall" | "heatflux" | "isothermal" | "farfield" | "symmetry";

export type BoundaryConditionKind = FeaBoundaryKind | CfdBoundaryKind;

export interface StressProbeMarker {
  id: string;
  label: string;
  nodeIndex: number;
  position: [number, number, number];
}

export interface FaceGeometricReadout {
  faceIndices: number[];
  totalArea: number;
  normal: [number, number, number];
  centroid: [number, number, number];
}

export interface BoundaryActionPayload {
  kind: BoundaryConditionKind;
  targetId: number | string;
  faceIndices?: number[] | undefined;
  dofs?: number[] | undefined;
  magnitude?: number | undefined;
  vector?: [number, number, number] | undefined;
  forceVector?: [number, number, number] | undefined;
  displacementVector?: [number, number, number] | undefined;
  pressurePa?: number | undefined;
  velocityMs?: number | undefined;
  temperatureK?: number | undefined;
  heatFluxWm2?: number | undefined;
  wallCondition?: "no_slip" | "slip" | undefined;
  area?: number | undefined;
  normal?: [number, number, number] | undefined;
  label?: string | undefined;
  worldPos?: [number, number, number] | undefined;
  portName?: string | undefined;
  portType?: string | undefined;
}

export interface BoundaryProbeFields {
  // FEA fields (stress in Pa, displacements in m [dx,dy,dz,...])
  stressPa?: ArrayLike<number> | undefined;
  displacementsM?: ArrayLike<number> | undefined;
  safetyFactor?: number | undefined;
  // CFD fields
  velocityMs?: ArrayLike<number> | undefined;
  pressurePa?: ArrayLike<number> | undefined;
  temperatureK?: ArrayLike<number> | undefined;
  qCriterion?: ArrayLike<number> | undefined;
  vorticity?: ArrayLike<number> | undefined;
  yPlus?: ArrayLike<number> | undefined;
}

export interface BoundaryPickerProps {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  defaultDomain?: "fea" | "cfd" | undefined;
  onSelectBoundary: (action: BoundaryActionPayload) => void;
  onHoverProbe?: ((probe: ProbeData | null) => void) | undefined;
  onAddStressProbe?: ((probe: StressProbeMarker) => void) | undefined;
  onSelectionChange?: ((selection: FaceGeometricReadout | null) => void) | undefined;
  stressProbes?: StressProbeMarker[] | undefined;
  probeFields?: BoundaryProbeFields | undefined;
  clippingPlanes?: THREE.Plane[] | undefined;
  onCommitFaceTag?:
    | ((payload: {
        portName: string;
        portType: string;
        faceIndices?: number[] | undefined;
        area?: number | undefined;
        normal?: [number, number, number] | undefined;
        worldPos: [number, number, number];
      }) => void)
    | undefined;
}

/** Compute triangle area, unit normal, and centroid for a face index. */
function computeFaceMetrics(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  faceIndex: number,
): { area: number; normal: [number, number, number]; centroid: [number, number, number] } {
  const i0 = indices[faceIndex * 3 + 0] ?? 0;
  const i1 = indices[faceIndex * 3 + 1] ?? i0;
  const i2 = indices[faceIndex * 3 + 2] ?? i0;

  const ax = positions[i0 * 3 + 0] ?? 0;
  const ay = positions[i0 * 3 + 1] ?? 0;
  const az = positions[i0 * 3 + 2] ?? 0;

  const bx = positions[i1 * 3 + 0] ?? 0;
  const by = positions[i1 * 3 + 1] ?? 0;
  const bz = positions[i1 * 3 + 2] ?? 0;

  const cx = positions[i2 * 3 + 0] ?? 0;
  const cy = positions[i2 * 3 + 1] ?? 0;
  const cz = positions[i2 * 3 + 2] ?? 0;

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const crossLen = Math.hypot(nx, ny, nz);
  const area = 0.5 * crossLen;

  const invLen = crossLen > 1e-12 ? 1 / crossLen : 0;
  return {
    area,
    normal: [nx * invLen, ny * invLen, nz * invLen],
    centroid: [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
  };
}

function computeAggregateSelection(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  faceIndices: number[],
): FaceGeometricReadout {
  let totalArea = 0;
  let wnx = 0;
  let wny = 0;
  let wnz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;

  for (const fIdx of faceIndices) {
    const m = computeFaceMetrics(positions, indices, fIdx);
    const w = m.area > 0 ? m.area : 1e-9;
    totalArea += m.area;
    wnx += m.normal[0] * w;
    wny += m.normal[1] * w;
    wnz += m.normal[2] * w;
    cx += m.centroid[0] * w;
    cy += m.centroid[1] * w;
    cz += m.centroid[2] * w;
  }

  const nLen = Math.hypot(wnx, wny, wnz);
  const invN = nLen > 1e-12 ? 1 / nLen : 0;
  const denom = totalArea > 1e-12 ? totalArea : Math.max(1, faceIndices.length) * 1e-9;

  return {
    faceIndices,
    totalArea,
    normal: [wnx * invN, wny * invN, wnz * invN],
    centroid: [cx / denom, cy / denom, cz / denom],
  };
}

function averageNodeField(arr: ArrayLike<number> | undefined, n0: number, n1: number, n2: number): number | undefined {
  if (!arr || n0 >= arr.length) return undefined;
  const v0 = arr[n0] ?? 0;
  const v1 = n1 < arr.length ? (arr[n1] ?? v0) : v0;
  const v2 = n2 < arr.length ? (arr[n2] ?? v0) : v0;
  return (v0 + v1 + v2) / 3;
}

export const BoundaryPicker: React.FC<BoundaryPickerProps> = ({
  positions,
  indices,
  defaultDomain = "fea",
  onSelectBoundary,
  onHoverProbe,
  onAddStressProbe,
  onSelectionChange,
  stressProbes,
  probeFields,
  clippingPlanes,
  onCommitFaceTag,
}) => {
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"fea" | "cfd" | "tag">(defaultDomain);
  const [activeMenu, setActiveMenu] = useState<{
    nodeId: number;
    faceIndex: number;
    worldPos: [number, number, number];
    normal: [number, number, number];
    area: number;
  } | null>(null);

  // FEA form state
  const [forceX, setForceX] = useState<string>("0");
  const [forceY, setForceY] = useState<string>("0");
  const [forceZ, setForceZ] = useState<string>("-1000");
  const [pressurePa, setPressurePa] = useState<string>("100000");
  const [dispX, setDispX] = useState<string>("0");
  const [dispY, setDispY] = useState<string>("0");
  const [dispZ, setDispZ] = useState<string>("0.001");

  // CFD form state
  const [cfdKind, setCfdKind] = useState<CfdBoundaryKind>("fluid_inlet");
  const [inletVelocity, setInletVelocity] = useState<string>("25");
  const [outletPressure, setOutletPressure] = useState<string>("101325");
  const [wallTempK, setWallTempK] = useState<string>("350");
  const [heatFluxWm2, setHeatFluxWm2] = useState<string>("5000");
  const [wallSlip, setWallSlip] = useState<"no_slip" | "slip">("no_slip");

  // Probe & Face Tag state
  const [probeLabel, setProbeLabel] = useState<string>("");
  const [portName, setPortName] = useState<string>("flange_1");
  const [portType, setPortType] = useState<string>("mechanical_flange");

  // Main raycast proxy geometry
  const { geometry, markerRadius } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    let rad = 0.012;
    if (positions.length > 0 && indices.length > 0) {
      const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
      const idxArr = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
      geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
      geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      if (geo.boundingSphere && geo.boundingSphere.radius > 0) {
        rad = Math.max(0.004, geo.boundingSphere.radius * 0.028);
      }
    }
    return { geometry: geo, markerRadius: rad };
  }, [positions, indices]);

  // Highlighted geometry for selected face set
  const selectionGeometry = useMemo(() => {
    if (selectedFaces.length === 0 || positions.length === 0 || indices.length === 0) {
      return null;
    }
    const verts = new Float32Array(selectedFaces.length * 9);
    let offset = 0;
    for (const fIdx of selectedFaces) {
      for (let corner = 0; corner < 3; corner++) {
        const vIdx = indices[fIdx * 3 + corner] ?? 0;
        verts[offset++] = positions[vIdx * 3 + 0] ?? 0;
        verts[offset++] = positions[vIdx * 3 + 1] ?? 0;
        verts[offset++] = positions[vIdx * 3 + 2] ?? 0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }, [selectedFaces, positions, indices]);

  const selectionReadout = useMemo(() => {
    if (selectedFaces.length === 0) return null;
    return computeAggregateSelection(positions, indices, selectedFaces);
  }, [selectedFaces, positions, indices]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.faceIndex === undefined || e.faceIndex === null || indices.length === 0) return;

    const fIdx = e.faceIndex;
    const n0 = indices[fIdx * 3 + 0] ?? 0;
    const n1 = indices[fIdx * 3 + 1] ?? n0;
    const n2 = indices[fIdx * 3 + 2] ?? n0;

    const pt = e.point;
    const worldPos: [number, number, number] = [pt.x, pt.y, pt.z];

    const avgStressPa = averageNodeField(probeFields?.stressPa, n0, n1, n2);
    const vonMisesMpa = avgStressPa !== undefined ? avgStressPa / 1e6 : undefined;

    let dispMagnitudeMm: number | undefined;
    let displacementVector: [number, number, number] | undefined;
    if (probeFields?.displacementsM && n0 * 3 + 2 < probeFields.displacementsM.length) {
      const dx = probeFields.displacementsM[n0 * 3 + 0] ?? 0;
      const dy = probeFields.displacementsM[n0 * 3 + 1] ?? 0;
      const dz = probeFields.displacementsM[n0 * 3 + 2] ?? 0;
      dispMagnitudeMm = Math.hypot(dx, dy, dz) * 1000;
      displacementVector = [dx, dy, dz];
    }

    onHoverProbe?.({
      screenX: e.clientX,
      screenY: e.clientY,
      worldPos,
      nodeIndex: n0,
      elementIndex: fIdx,
      faceIndex: fIdx,
      vonMisesMpa,
      dispMagnitudeMm,
      displacementVector,
      safetyFactor: probeFields?.safetyFactor,
      velocityMs: averageNodeField(probeFields?.velocityMs, n0, n1, n2),
      pressurePa: averageNodeField(probeFields?.pressurePa, n0, n1, n2),
      temperatureK: averageNodeField(probeFields?.temperatureK, n0, n1, n2),
      qCriterion: averageNodeField(probeFields?.qCriterion, n0, n1, n2),
      vorticity: averageNodeField(probeFields?.vorticity, n0, n1, n2),
      yPlus: averageNodeField(probeFields?.yPlus, n0, n1, n2),
    });
  };

  const handlePointerOut = () => {
    onHoverProbe?.(null);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.faceIndex === undefined || e.faceIndex === null) return;

    const fIdx = e.faceIndex;
    const n0 = indices[fIdx * 3 + 0] ?? 0;
    const pt = e.point;
    const metrics = computeFaceMetrics(positions, indices, fIdx);
    const norm: [number, number, number] = e.face?.normal
      ? [e.face.normal.x, e.face.normal.y, e.face.normal.z]
      : metrics.normal;

    const addToSet = multiSelectMode || e.shiftKey;
    const nextFaces = addToSet
      ? selectedFaces.includes(fIdx)
        ? selectedFaces.filter((f) => f !== fIdx)
        : [...selectedFaces, fIdx]
      : [fIdx];

    setSelectedFaces(nextFaces);
    onSelectionChange?.(nextFaces.length > 0 ? computeAggregateSelection(positions, indices, nextFaces) : null);

    setProbeLabel(`Stress Pt #${(stressProbes?.length ?? 0) + 1} (N${n0 + 1})`);
    setActiveMenu({
      nodeId: n0,
      faceIndex: fIdx,
      worldPos: [pt.x, pt.y, pt.z],
      normal: norm,
      area: metrics.area,
    });
  };

  const closeMenu = () => {
    setActiveMenu(null);
  };

  const clearSelection = () => {
    setSelectedFaces([]);
    onSelectionChange?.(null);
    setActiveMenu(null);
  };

  const effectiveFaces = selectedFaces.length > 0 ? selectedFaces : activeMenu ? [activeMenu.faceIndex] : [];
  const effectiveArea = selectionReadout?.totalArea ?? activeMenu?.area ?? 0;
  const effectiveNormal = selectionReadout?.normal ?? activeMenu?.normal ?? [0, 0, 1];
  const patchTargetId =
    effectiveFaces.length > 1
      ? `face_set_${effectiveFaces.length}_${effectiveFaces[0] ?? 0}`
      : `patch_${activeMenu?.faceIndex ?? 0}`;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--ms-bg, #ffffff)",
    border: "1px solid var(--ms-border, var(--color-border-default))",
    borderRadius: "var(--ms-radius-sm, 6px)",
    color: "var(--ms-text-1, var(--color-fg-default))",
    fontSize: "var(--text-2xs, 11px)",
    padding: "4px 6px",
    fontFamily: "var(--ms-font-mono, monospace)",
    fontVariantNumeric: "tabular-nums",
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "5px 6px",
    borderRadius: "var(--ms-radius-sm, 6px)",
    border: active ? "1px solid var(--ms-brand, #0e7490)" : "1px solid var(--ms-border)",
    background: active ? "var(--ms-brand-soft)" : "var(--ms-bg-alt)",
    color: active ? "var(--ms-brand, #0e7490)" : "var(--ms-text-2)",
    fontSize: "var(--text-2xs, 11px)",
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <group>
      {/* Raycast Surface Proxy */}
      <mesh
        geometry={geometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
      >
        <meshStandardMaterial
          color="#38bdf8"
          transparent={true}
          opacity={0.01}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes ?? null}
        />
      </mesh>

      {/* Multi-Face Selection Highlight Overlay */}
      {selectionGeometry && (
        <mesh geometry={selectionGeometry}>
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={0.45}
            transparent={true}
            opacity={0.45}
            side={THREE.DoubleSide}
            depthWrite={false}
            polygonOffset={true}
            polygonOffsetFactor={-1}
            clippingPlanes={clippingPlanes ?? null}
          />
        </mesh>
      )}

      {/* 3D Stress Probe Point Markers */}
      {stressProbes?.map((probe) => (
        <group key={probe.id} position={probe.position}>
          <mesh>
            <octahedronGeometry args={[markerRadius, 1]} />
            <meshStandardMaterial color="#f59e0b" emissive="#d97706" emissiveIntensity={0.65} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* Floating Boundary Assignment Popover */}
      {activeMenu && (
        <Html position={activeMenu.worldPos}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              transform: "translate(-50%, -112%)",
              background: "var(--ms-surface-glass, var(--ms-bg))",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--ms-border, var(--color-border-default))",
              borderRadius: "var(--ms-radius-md, 10px)",
              padding: "10px 12px",
              boxShadow: "var(--ms-shadow-pop, 0 16px 40px -12px rgba(15, 23, 42, 0.25))",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              width: "280px",
              fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
              fontSize: "var(--text-xs, 12px)",
              color: "var(--ms-text-1, var(--color-fg-default))",
              zIndex: 2000,
            }}
          >
            {/* Header + Multi-Face Controls */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: "6px",
                borderBottom: "1px solid var(--ms-divider)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "var(--ms-brand, #0e7490)", fontWeight: 600 }}>
                  {effectiveFaces.length > 1
                    ? `${effectiveFaces.length} Faces Selected`
                    : `Face #${activeMenu.faceIndex + 1} · N${activeMenu.nodeId + 1}`}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <button
                  type="button"
                  onClick={() => setMultiSelectMode((m) => !m)}
                  title="Toggle multi-face selection (or hold Shift+Click)"
                  style={{
                    background: multiSelectMode ? "var(--ms-brand-soft)" : "var(--ms-bg-alt)",
                    border: multiSelectMode ? "1px solid var(--ms-brand)" : "1px solid var(--ms-border)",
                    borderRadius: "4px",
                    color: multiSelectMode ? "var(--ms-brand)" : "var(--ms-text-2)",
                    fontSize: "var(--text-2xs, 11px)",
                    fontWeight: 600,
                    padding: "2px 6px",
                    cursor: "pointer",
                  }}
                >
                  +Multi
                </button>
                {selectedFaces.length > 1 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--ms-status-fail-fg, var(--ms-danger))",
                      fontSize: "var(--text-2xs, 11px)",
                      cursor: "pointer",
                      padding: "2px 4px",
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="Close boundary picker"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "22px",
                    height: "22px",
                    background: "transparent",
                    border: "none",
                    color: "var(--ms-text-2)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <XIcon size={13} />
                </button>
              </div>
            </div>

            {/* Live Geometric Readout */}
            <div
              style={{
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-divider)",
                borderRadius: "var(--ms-radius-sm, 6px)",
                padding: "6px 8px",
                fontSize: "var(--text-2xs, 11px)",
                fontFamily: "var(--ms-font-mono, monospace)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--ms-text-2)",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <div>
                Area: <strong style={{ color: "var(--ms-text-1)" }}>{effectiveArea.toExponential(3)} m²</strong>
              </div>
              <div>
                Normal:{" "}
                <strong style={{ color: "var(--ms-brand, #0e7490)" }}>
                  ({effectiveNormal[0].toFixed(3)}, {effectiveNormal[1].toFixed(3)}, {effectiveNormal[2].toFixed(3)})
                </strong>
              </div>
            </div>

            {/* Domain Tabs */}
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={() => setActiveTab("fea")} style={tabBtnStyle(activeTab === "fea")}>
                FEA
              </button>
              <button type="button" onClick={() => setActiveTab("cfd")} style={tabBtnStyle(activeTab === "cfd")}>
                CFD
              </button>
              <button type="button" onClick={() => setActiveTab("tag")} style={tabBtnStyle(activeTab === "tag")}>
                Probe / Tag
              </button>
            </div>

            {/* FEA Tab */}
            {activeTab === "fea" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {/* Fixed Support */}
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectBoundary({
                        kind: "fixed_support",
                        targetId: effectiveFaces.length > 1 ? patchTargetId : activeMenu.nodeId,
                        faceIndices: effectiveFaces,
                        dofs: [1, 2, 3],
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      flex: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      background: "var(--ms-brand-soft)",
                      border: "1px solid var(--ms-border)",
                      borderRadius: "var(--ms-radius-sm, 6px)",
                      padding: "5px 6px",
                      color: "var(--ms-brand, #0e7490)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "var(--text-2xs, 11px)",
                    }}
                  >
                    <LockIcon size={11} /> Pin (1–3)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectBoundary({
                        kind: "fixed_support",
                        targetId: effectiveFaces.length > 1 ? patchTargetId : activeMenu.nodeId,
                        faceIndices: effectiveFaces,
                        dofs: [1, 2, 3, 4, 5, 6],
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      flex: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      background: "var(--ms-brand-soft)",
                      border: "1px solid var(--ms-border)",
                      borderRadius: "var(--ms-radius-sm, 6px)",
                      padding: "5px 6px",
                      color: "var(--ms-brand, #0e7490)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "var(--text-2xs, 11px)",
                    }}
                  >
                    <LockIcon size={11} /> Clamp (1–6)
                  </button>
                </div>

                {/* Nodal / Face Force Load */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "10px", color: "#cbd5e1", fontWeight: 600 }}>Force Load (N)</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                    <div>
                      <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fx</label>
                      <input
                        type="number"
                        value={forceX}
                        onChange={(e) => setForceX(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fy</label>
                      <input
                        type="number"
                        value={forceY}
                        onChange={(e) => setForceY(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "9px", color: "#94a3b8" }}>Fz</label>
                      <input
                        type="number"
                        value={forceZ}
                        onChange={(e) => setForceZ(e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const fx = parseFloat(forceX) || 0;
                      const fy = parseFloat(forceY) || 0;
                      const fz = parseFloat(forceZ) || 0;
                      const mag = Math.hypot(fx, fy, fz) || 1;
                      onSelectBoundary({
                        kind: "force_load",
                        targetId: effectiveFaces.length > 1 ? patchTargetId : activeMenu.nodeId,
                        faceIndices: effectiveFaces,
                        magnitude: mag,
                        vector: [fx / mag, fy / mag, fz / mag],
                        forceVector: [fx, fy, fz],
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      background: "rgba(239, 68, 68, 0.22)",
                      border: "1px solid rgba(239, 68, 68, 0.45)",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      color: "#f87171",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "10px",
                    }}
                  >
                    ⚡ Apply Force ({forceX}, {forceY}, {forceZ}) N
                  </button>
                </div>

                {/* Surface Pressure Load */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: "6px",
                    display: "flex",
                    gap: "5px",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block" }}>Pressure Load (Pa)</label>
                    <input
                      type="number"
                      value={pressurePa}
                      onChange={(e) => setPressurePa(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const pVal = parseFloat(pressurePa) || 0;
                      onSelectBoundary({
                        kind: "pressure_load",
                        targetId: patchTargetId,
                        faceIndices: effectiveFaces,
                        pressurePa: pVal,
                        magnitude: pVal,
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      background: "rgba(168, 85, 247, 0.22)",
                      border: "1px solid rgba(168, 85, 247, 0.5)",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      color: "#c084fc",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "10px",
                    }}
                  >
                    Apply P
                  </button>
                </div>

                {/* Prescribed Displacement */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "10px", color: "#cbd5e1", fontWeight: 600 }}>
                    Prescribed Displacement (m)
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                    <input
                      type="number"
                      step="0.0001"
                      value={dispX}
                      onChange={(e) => setDispX(e.target.value)}
                      placeholder="ux"
                      style={inputStyle}
                    />
                    <input
                      type="number"
                      step="0.0001"
                      value={dispY}
                      onChange={(e) => setDispY(e.target.value)}
                      placeholder="uy"
                      style={inputStyle}
                    />
                    <input
                      type="number"
                      step="0.0001"
                      value={dispZ}
                      onChange={(e) => setDispZ(e.target.value)}
                      placeholder="uz"
                      style={inputStyle}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const ux = parseFloat(dispX) || 0;
                      const uy = parseFloat(dispY) || 0;
                      const uz = parseFloat(dispZ) || 0;
                      onSelectBoundary({
                        kind: "prescribed_displacement",
                        targetId: effectiveFaces.length > 1 ? patchTargetId : activeMenu.nodeId,
                        faceIndices: effectiveFaces,
                        displacementVector: [ux, uy, uz],
                        magnitude: Math.hypot(ux, uy, uz),
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      background: "rgba(16, 185, 129, 0.2)",
                      border: "1px solid rgba(16, 185, 129, 0.45)",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      color: "#34d399",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "10px",
                    }}
                  >
                    ↔ Prescribe Displacement
                  </button>
                </div>
              </div>
            )}

            {/* CFD Tab */}
            {activeTab === "cfd" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                <div>
                  <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                    CFD Boundary Condition Type
                  </label>
                  <select
                    value={cfdKind}
                    onChange={(e) => setCfdKind(e.target.value as CfdBoundaryKind)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    <option value="fluid_inlet">Fluid Inlet (Velocity / Mass Flow)</option>
                    <option value="fluid_outlet">Fluid Outlet (Static Pressure)</option>
                    <option value="wall">Wall (No-Slip / Slip)</option>
                    <option value="heatflux">Heat Flux Wall (W/m²)</option>
                    <option value="isothermal">Isothermal Wall (K)</option>
                    <option value="farfield">Freestream / Farfield</option>
                    <option value="symmetry">Symmetry Plane</option>
                  </select>
                </div>

                {(cfdKind === "fluid_inlet" || cfdKind === "farfield") && (
                  <div>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                      Velocity Magnitude (m/s)
                    </label>
                    <input
                      type="number"
                      value={inletVelocity}
                      onChange={(e) => setInletVelocity(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                )}

                {(cfdKind === "fluid_outlet" || cfdKind === "farfield") && (
                  <div>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                      Static Pressure (Pa)
                    </label>
                    <input
                      type="number"
                      value={outletPressure}
                      onChange={(e) => setOutletPressure(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                )}

                {cfdKind === "wall" && (
                  <div>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                      Shear Condition
                    </label>
                    <select
                      value={wallSlip}
                      onChange={(e) => setWallSlip(e.target.value as "no_slip" | "slip")}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="no_slip">No-Slip Viscous Wall</option>
                      <option value="slip">Free-Slip / Inviscid Wall</option>
                    </select>
                  </div>
                )}

                {cfdKind === "heatflux" && (
                  <div>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                      Wall Heat Flux q&quot; (W/m²)
                    </label>
                    <input
                      type="number"
                      value={heatFluxWm2}
                      onChange={(e) => setHeatFluxWm2(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                )}

                {cfdKind === "isothermal" && (
                  <div>
                    <label style={{ fontSize: "9px", color: "#94a3b8", display: "block", marginBottom: "2px" }}>
                      Wall Temperature (K)
                    </label>
                    <input
                      type="number"
                      value={wallTempK}
                      onChange={(e) => setWallTempK(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSelectBoundary({
                      kind: cfdKind,
                      targetId: patchTargetId,
                      faceIndices: effectiveFaces,
                      area: effectiveArea,
                      normal: effectiveNormal,
                      worldPos: activeMenu.worldPos,
                      velocityMs:
                        cfdKind === "fluid_inlet" || cfdKind === "farfield"
                          ? parseFloat(inletVelocity) || 0
                          : undefined,
                      pressurePa:
                        cfdKind === "fluid_outlet" || cfdKind === "farfield"
                          ? parseFloat(outletPressure) || 101325
                          : undefined,
                      temperatureK: cfdKind === "isothermal" ? parseFloat(wallTempK) || 300 : undefined,
                      heatFluxWm2: cfdKind === "heatflux" ? parseFloat(heatFluxWm2) || 0 : undefined,
                      wallCondition: cfdKind === "wall" ? wallSlip : undefined,
                    });
                    closeMenu();
                  }}
                  style={{
                    background: "rgba(34, 197, 94, 0.22)",
                    border: "1px solid rgba(34, 197, 94, 0.5)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    color: "#4ade80",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "10px",
                  }}
                >
                  🌊 Assign {cfdKind.replace("_", " ")} ({effectiveFaces.length} face
                  {effectiveFaces.length === 1 ? "" : "s"})
                </button>
              </div>
            )}

            {/* Probe & Face Tag Tab */}
            {activeTab === "tag" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Stress Probe Point */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "10px", color: "#fcd34d", fontWeight: 600 }}>
                    Stress / Field Probe Point
                  </span>
                  <input
                    type="text"
                    value={probeLabel}
                    onChange={(e) => setProbeLabel(e.target.value)}
                    placeholder="e.g. Fillet Root Stress Pt"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const label = probeLabel.trim() || `Probe N${activeMenu.nodeId + 1}`;
                      const probe: StressProbeMarker = {
                        id: `probe-${activeMenu.nodeId}-${Date.now()}`,
                        label,
                        nodeIndex: activeMenu.nodeId,
                        position: activeMenu.worldPos,
                      };
                      onAddStressProbe?.(probe);
                      onSelectBoundary({
                        kind: "stress_probe",
                        targetId: activeMenu.nodeId,
                        faceIndices: effectiveFaces,
                        label,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      background: "rgba(245, 158, 11, 0.22)",
                      border: "1px solid rgba(245, 158, 11, 0.5)",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      color: "#fbbf24",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "10px",
                    }}
                  >
                    🎯 Add Stress Probe Point
                  </button>
                </div>

                {/* Face Tag / Physical Port */}
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "10px", color: "#38bdf8", fontWeight: 600 }}>Tag Physical Port / Face</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                    <div>
                      <label style={{ fontSize: "9px", color: "#94a3b8" }}>Port Name</label>
                      <input
                        type="text"
                        value={portName}
                        onChange={(e) => setPortName(e.target.value)}
                        placeholder="flange_1"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "9px", color: "#94a3b8" }}>Port Type</label>
                      <select
                        value={portType}
                        onChange={(e) => setPortType(e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}
                      >
                        <option value="mechanical_flange">mechanical_flange</option>
                        <option value="fixed_support">fixed_support</option>
                        <option value="frame">frame</option>
                        <option value="fluid">fluid</option>
                        <option value="thermal">thermal</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const name = portName.trim() || "flange_1";
                      onCommitFaceTag?.({
                        portName: name,
                        portType,
                        faceIndices: effectiveFaces,
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      onSelectBoundary({
                        kind: "face_tag",
                        targetId: patchTargetId,
                        faceIndices: effectiveFaces,
                        portName: name,
                        portType,
                        area: effectiveArea,
                        normal: effectiveNormal,
                        worldPos: activeMenu.worldPos,
                      });
                      closeMenu();
                    }}
                    style={{
                      background: "rgba(56, 189, 248, 0.22)",
                      border: "1px solid rgba(56, 189, 248, 0.5)",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      color: "#38bdf8",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "10px",
                    }}
                  >
                    🏷️ Tag Face / Port ({portName})
                  </button>
                </div>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
};
