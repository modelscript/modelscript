// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { useMemo, useState } from "react";
import * as THREE from "three";
import type { AmplGeomInfo } from "./AmplConstraints2D";

const PLANE_COLORS = ["#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];

function evalLinear(constant: number, coeffs: Record<string, number>, pt: Record<string, number>): number {
  let sum = constant;
  for (const [k, c] of Object.entries(coeffs)) {
    sum += c * (pt[k] ?? 0);
  }
  return sum;
}

const SurfaceMesh2D: React.FC<{
  geometry: AmplGeomInfo;
  solution: Record<string, number>;
  varX: string;
  varY: string;
}> = ({ geometry, solution, varX, varY }) => {
  const { meshGeo, optPos, bounds } = useMemo(() => {
    const vx = geometry.variables.find((v) => v.name === varX);
    const vy = geometry.variables.find((v) => v.name === varY);
    const ox = solution[varX] ?? 0;
    const oy = solution[varY] ?? 0;

    const xMin = vx?.lb ?? Math.min(0, ox - 5);
    const xMax = vx?.ub ?? Math.max(ox * 1.6, xMin + 8);
    const yMin = vy?.lb ?? Math.min(0, oy - 5);
    const yMax = vy?.ub ?? Math.max(oy * 1.6, yMin + 8);

    const obj = geometry.objectives[0];
    const N = 36;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const zVals: number[] = [];
    const feasFlags: boolean[] = [];

    for (let j = 0; j <= N; j++) {
      const y = yMin + ((yMax - yMin) * j) / N;
      for (let i = 0; i <= N; i++) {
        const x = xMin + ((xMax - xMin) * i) / N;
        const pt: Record<string, number> = { ...solution, [varX]: x, [varY]: y };
        const z = obj ? evalLinear(obj.constant, obj.linearCoeffs, pt) : 0;
        let feas = true;
        for (const c of geometry.constraints) {
          const val = evalLinear(c.constant, c.linearCoeffs, pt);
          if (c.ub !== null && val > c.ub + 1e-6) feas = false;
          if (c.lb !== null && val < c.lb - 1e-6) feas = false;
        }
        zVals.push(z);
        feasFlags.push(feas);
      }
    }

    const zMin = Math.min(...zVals);
    const zMax = Math.max(...zVals);
    const zSpan = zMax - zMin || 1;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const toScene = (x: number, y: number, z: number): [number, number, number] => [
      ((x - xMin) / xSpan) * 4 - 2,
      ((z - zMin) / zSpan) * 2.4 - 0.8,
      ((y - yMin) / ySpan) * 4 - 2,
    ];

    for (let j = 0; j <= N; j++) {
      const y = yMin + ((yMax - yMin) * j) / N;
      for (let i = 0; i <= N; i++) {
        const x = xMin + ((xMax - xMin) * i) / N;
        const idx = j * (N + 1) + i;
        const z = zVals[idx]!;
        const feas = feasFlags[idx]!;
        const [sx, sy, sz] = toScene(x, y, z);
        positions.push(sx, sy, sz);

        const t = (z - zMin) / zSpan;
        if (feas) {
          colors.push(0.05 + 0.12 * t, 0.55 + 0.35 * t, 0.52 - 0.15 * t);
        } else {
          colors.push(0.45, 0.18, 0.2);
        }
      }
    }

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        const b = a + 1;
        const c = a + (N + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const optZ = obj ? evalLinear(obj.constant, obj.linearCoeffs, solution) : 0;
    return {
      meshGeo: geo,
      optPos: toScene(ox, oy, optZ),
      bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
    };
  }, [geometry, solution, varX, varY]);

  return (
    <group>
      <mesh geometry={meshGeo}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={optPos}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} />
      </mesh>
      <Html position={[optPos[0], optPos[1] + 0.25, optPos[2]]} center>
        <div
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#4ade80",
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            border: "1px solid rgba(74, 222, 128, 0.4)",
          }}
        >
          Opt ({(solution[varX] ?? 0).toFixed(2)}, {(solution[varY] ?? 0).toFixed(2)})
        </div>
      </Html>
      <Html position={[2.15, -0.9, -2]} center>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
          {varX} [{bounds.xMin.toFixed(1)}, {bounds.xMax.toFixed(1)}]
        </div>
      </Html>
      <Html position={[-2, -0.9, 2.15]} center>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
          {varY} [{bounds.yMin.toFixed(1)}, {bounds.yMax.toFixed(1)}]
        </div>
      </Html>
    </group>
  );
};

const Polytope3D: React.FC<{
  geometry: AmplGeomInfo;
  solution: Record<string, number>;
  varX: string;
  varY: string;
  varZ: string;
}> = ({ geometry, solution, varX, varY, varZ }) => {
  const { planes, feasiblePts, optPos } = useMemo(() => {
    const getSpan = (name: string) => {
      const v = geometry.variables.find((vr) => vr.name === name);
      const ov = solution[name] ?? 0;
      const lo = v?.lb ?? Math.min(0, ov - 4);
      const hi = v?.ub ?? Math.max(ov * 1.6, lo + 8);
      return { lo, hi, span: hi - lo || 1 };
    };
    const sx = getSpan(varX);
    const sy = getSpan(varY);
    const sz = getSpan(varZ);

    const toScene = (x: number, y: number, z: number): [number, number, number] => [
      ((x - sx.lo) / sx.span) * 3.6 - 1.8,
      ((z - sz.lo) / sz.span) * 3.6 - 1.8,
      ((y - sy.lo) / sy.span) * 3.6 - 1.8,
    ];

    // Sample feasible points inside bounding box
    const pts: number[] = [];
    const M = 10;
    for (let ix = 0; ix <= M; ix++) {
      const x = sx.lo + (sx.span * ix) / M;
      for (let iy = 0; iy <= M; iy++) {
        const y = sy.lo + (sy.span * iy) / M;
        for (let iz = 0; iz <= M; iz++) {
          const z = sz.lo + (sz.span * iz) / M;
          const pt: Record<string, number> = { ...solution, [varX]: x, [varY]: y, [varZ]: z };
          let ok = true;
          for (const c of geometry.constraints) {
            const val = evalLinear(c.constant, c.linearCoeffs, pt);
            if (c.ub !== null && val > c.ub + 1e-6) {
              ok = false;
              break;
            }
            if (c.lb !== null && val < c.lb - 1e-6) {
              ok = false;
              break;
            }
          }
          if (ok) {
            const [px, py, pz] = toScene(x, y, z);
            pts.push(px, py, pz);
          }
        }
      }
    }

    // Constraint planes
    const planeList: Array<{ pos: [number, number, number]; quat: THREE.Quaternion; color: string; name: string }> = [];
    geometry.constraints.slice(0, 6).forEach((c, idx) => {
      const a = (c.linearCoeffs[varX] ?? 0) * sx.span;
      const b = (c.linearCoeffs[varZ] ?? 0) * sz.span;
      const d = (c.linearCoeffs[varY] ?? 0) * sy.span;
      const normal = new THREE.Vector3(a, b, d);
      if (normal.lengthSq() < 1e-10) return;
      normal.normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      // Find a point on plane in scene coords
      const bound = c.ub ?? c.lb ?? 0;
      let fixedC = c.constant;
      for (const [k, coef] of Object.entries(c.linearCoeffs)) {
        if (k !== varX && k !== varY && k !== varZ) fixedC += coef * (solution[k] ?? 0);
      }
      const rhs = bound - fixedC;
      const cx = c.linearCoeffs[varX] ?? 0;
      const cy = c.linearCoeffs[varY] ?? 0;
      const cz = c.linearCoeffs[varZ] ?? 0;
      const normSq = cx * cx + cy * cy + cz * cz || 1;
      const px = (rhs * cx) / normSq;
      const py = (rhs * cy) / normSq;
      const pz = (rhs * cz) / normSq;

      planeList.push({
        pos: toScene(px, py, pz),
        quat,
        color: PLANE_COLORS[idx % PLANE_COLORS.length]!,
        name: c.name,
      });
    });

    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));

    return {
      planes: planeList,
      feasiblePts: ptGeo,
      optPos: toScene(solution[varX] ?? 0, solution[varY] ?? 0, solution[varZ] ?? 0),
    };
  }, [geometry, solution, varX, varY, varZ]);

  return (
    <group>
      <points geometry={feasiblePts}>
        <pointsMaterial color="#14b8a6" size={0.09} sizeAttenuation />
      </points>
      {planes.map((pl, idx) => (
        <mesh key={idx} position={pl.pos} quaternion={pl.quat}>
          <planeGeometry args={[3.8, 3.8]} />
          <meshStandardMaterial
            color={pl.color}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh position={optPos}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} />
      </mesh>
      <Html position={[optPos[0], optPos[1] + 0.26, optPos[2]]} center>
        <div
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#4ade80",
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}
        >
          Optimum
        </div>
      </Html>
    </group>
  );
};

export const AmplConstraints3D: React.FC<{
  geometry: AmplGeomInfo;
  solution: Record<string, number>;
}> = ({ geometry, solution }) => {
  const vars = geometry.variables;
  const [mode, setMode] = useState<"surface" | "polytope">(() => (vars.length >= 3 ? "polytope" : "surface"));
  const [varX, setVarX] = useState(vars[0]?.name ?? "");
  const [varY, setVarY] = useState(vars[1]?.name ?? vars[0]?.name ?? "");
  const [varZ, setVarZ] = useState(vars[2]?.name ?? vars[0]?.name ?? "");

  const borderCol = "var(--color-border-default, var(--ms-border, rgba(148, 163, 184, 0.18)))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";

  if (vars.length < 2) {
    return (
      <div style={{ padding: 24, color: textMuted, fontSize: 13 }}>
        At least 2 decision variables are required for 3D visualization.
      </div>
    );
  }

  const effectiveX = vars.some((v) => v.name === varX) ? varX : vars[0]!.name;
  const effectiveY = vars.some((v) => v.name === varY) ? varY : (vars[1]?.name ?? vars[0]!.name);
  const effectiveZ = vars.some((v) => v.name === varZ) ? varZ : (vars[2]?.name ?? vars[0]!.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }}>
        {vars.length >= 3 && (
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "surface" | "polytope")}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
            }}
          >
            <option value="polytope">3D Constraint Polytope (X, Y, Z)</option>
            <option value="surface">3D Objective Surface (X, Y, Obj)</option>
          </select>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: textMuted }}>X:</span>
          <select
            value={effectiveX}
            onChange={(e) => setVarX(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
            }}
          >
            {vars.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: textMuted }}>Y:</span>
          <select
            value={effectiveY}
            onChange={(e) => setVarY(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
            }}
          >
            {vars.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        {mode === "polytope" && vars.length >= 3 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: textMuted }}>Z:</span>
            <select
              value={effectiveZ}
              onChange={(e) => setVarZ(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: cardBg,
                color: textPrimary,
              }}
            >
              {vars.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <span style={{ color: textMuted, marginLeft: "auto" }}>
          Drag to orbit · Scroll to zoom · Teal = feasible, Red = infeasible
        </span>
      </div>

      <div
        style={{
          width: "100%",
          height: 440,
          borderRadius: 8,
          border: `1px solid ${borderCol}`,
          overflow: "hidden",
          backgroundColor: "#0b1120",
        }}
      >
        <Canvas camera={{ position: [4.5, 3.6, 4.5], fov: 45 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[6, 8, 5]} intensity={0.9} />
          <gridHelper args={[6, 12, "#334155", "#1e293b"]} position={[0, -1.8, 0]} />
          <axesHelper args={[2.5]} />
          {mode === "polytope" && vars.length >= 3 ? (
            <Polytope3D geometry={geometry} solution={solution} varX={effectiveX} varY={effectiveY} varZ={effectiveZ} />
          ) : (
            <SurfaceMesh2D geometry={geometry} solution={solution} varX={effectiveX} varY={effectiveY} />
          )}
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
};
