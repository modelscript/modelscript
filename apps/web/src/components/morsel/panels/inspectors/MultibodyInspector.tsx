// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import { parseUrdf } from "@modelscript/urdf";
import React, { useMemo, useState } from "react";

export interface MultibodyInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface ParsedBody {
  name: string;
  mass: number;
  com: [number, number, number];
  ixx: number;
  iyy: number;
  izz: number;
  isGround: boolean;
  line: number;
}

export interface ParsedJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  dof: number;
  lower?: number | undefined;
  upper?: number | undefined;
  effort?: number | undefined;
  line: number;
}

export interface MultibodySummary {
  bodies: ParsedBody[];
  joints: ParsedJoint[];
  bodyCountWithGround: number;
  jointDofSum: number;
  grublerMobility: number;
  hasClosedLoops: boolean;
  totalMassKg: number;
}

const JOINT_DOF: Record<string, number> = {
  revolute: 1,
  continuous: 1,
  prismatic: 1,
  translational: 1,
  screw: 1,
  cylindrical: 2,
  universal: 2,
  hooke: 2,
  planar: 3,
  spherical: 3,
  ball: 3,
  floating: 6,
  free: 6,
  fixed: 0,
  weld: 0,
  bracket: 0,
};

function findLine(lines: string[], needle: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(needle)) return i + 1;
  }
  return 1;
}

export function analyzeMultibodyKinematics(code: string, lines: string[]): MultibodySummary {
  const bodies: ParsedBody[] = [];
  const joints: ParsedJoint[] = [];

  // 1. URDF XML parser + inertial/origin/limit extraction
  if (code.includes("<robot") || code.includes("<link") || code.includes("<joint")) {
    try {
      const urdf = parseUrdf(code);
      for (const link of urdf.links) {
        const ln = findLine(lines, `name="${link.name}"`);
        bodies.push({
          name: link.name,
          mass: link.inertial?.mass ?? 0,
          com: link.inertial?.originXyz ?? [0, 0, 0],
          ixx: link.inertial?.inertia?.ixx ?? 0,
          iyy: link.inertial?.inertia?.iyy ?? 0,
          izz: link.inertial?.inertia?.izz ?? 0,
          isGround: !urdf.joints.some((j) => j.child === link.name),
          line: ln,
        });
      }
      for (const j of urdf.joints) {
        const typeLower = j.type.toLowerCase();
        const ln = findLine(lines, `name="${j.name}"`);
        joints.push({
          name: j.name,
          type: typeLower,
          parent: j.parent,
          child: j.child,
          dof: JOINT_DOF[typeLower] ?? 1,
          lower: j.limit?.lower,
          upper: j.limit?.upper,
          effort: j.limit?.effort,
          line: ln,
        });
      }
    } catch {
      // Fall back to regex tag scanning if malformed XML
      const linkRe =
        /<link\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/link>|<link\b[^>]*\bname=["']([^"']+)["'][^>]*\/>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(code)) !== null) {
        const name = (m[1] ?? m[3])!;
        const inner = m[2] ?? "";
        const mass = Number(/<mass\b[^>]*\bvalue=["']([^"']+)["']/i.exec(inner)?.[1] ?? 0);
        const xyzRaw = /<inertial[\s\S]*?<origin\b[^>]*\bxyz=["']([^"']+)["']/i.exec(inner)?.[1];
        const xyzParts = xyzRaw ? xyzRaw.trim().split(/\s+/).map(Number) : [0, 0, 0];
        const ixx = Number(/\bixx=["']([^"']+)["']/i.exec(inner)?.[1] ?? 0);
        const iyy = Number(/\biyy=["']([^"']+)["']/i.exec(inner)?.[1] ?? 0);
        const izz = Number(/\bizz=["']([^"']+)["']/i.exec(inner)?.[1] ?? 0);
        const line = code.slice(0, m.index).split("\n").length;
        bodies.push({
          name,
          mass,
          com: [xyzParts[0] || 0, xyzParts[1] || 0, xyzParts[2] || 0],
          ixx,
          iyy,
          izz,
          isGround: false,
          line,
        });
      }
      const jointRe = /<joint\b[^>]*\bname=["']([^"']+)["'][^>]*\btype=["']([^"']+)["'][^>]*>([\s\S]*?)<\/joint>/gi;
      while ((m = jointRe.exec(code)) !== null) {
        const name = m[1]!;
        const type = m[2]!.toLowerCase();
        const inner = m[3]!;
        const parent = /<parent\b[^>]*\blink=["']([^"']+)["']/i.exec(inner)?.[1] ?? "base";
        const child = /<child\b[^>]*\blink=["']([^"']+)["']/i.exec(inner)?.[1] ?? "link";
        const lowerStr = /<limit\b[^>]*\blower=["']([^"']+)["']/i.exec(inner)?.[1];
        const upperStr = /<limit\b[^>]*\bupper=["']([^"']+)["']/i.exec(inner)?.[1];
        const effortStr = /<limit\b[^>]*\beffort=["']([^"']+)["']/i.exec(inner)?.[1];
        const line = code.slice(0, m.index).split("\n").length;
        joints.push({
          name,
          type,
          parent,
          child,
          dof: JOINT_DOF[type] ?? 1,
          ...(lowerStr !== undefined ? { lower: Number(lowerStr) } : {}),
          ...(upperStr !== undefined ? { upper: Number(upperStr) } : {}),
          ...(effortStr !== undefined ? { effort: Number(effortStr) } : {}),
          line,
        });
      }
    }
  }

  // 2. ADAMS (.adm), GENSYS, and SIMPACK line-oriented records
  if (bodies.length === 0 && joints.length === 0) {
    const markerToPart = new Map<string, string>();
    let currentPart = "";
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (!t || t.startsWith("!") || t.startsWith("#") || t.startsWith("//")) continue;

      // ADAMS PART/id, GROUND or MASS = ...
      const adamsPart = /^PART\/(\d+)(.*)$/i.exec(t);
      if (adamsPart) {
        currentPart = `PART_${adamsPart[1]}`;
        const rest = adamsPart[2]!;
        const isGround = /\bGROUND\b/i.test(rest);
        const mass = Number(/\bMASS\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? (isGround ? 0 : 1));
        const ip = /\bIP\s*=\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)/i.exec(rest);
        bodies.push({
          name: currentPart,
          mass,
          com: [0, 0, 0],
          ixx: Number(ip?.[1] ?? 0),
          iyy: Number(ip?.[2] ?? 0),
          izz: Number(ip?.[3] ?? 0),
          isGround,
          line: i + 1,
        });
        continue;
      }

      const adamsMarker = /^MARKER\/(\d+)\s*,\s*PART\s*=\s*(\d+)/i.exec(t);
      if (adamsMarker) {
        markerToPart.set(adamsMarker[1]!, `PART_${adamsMarker[2]}`);
        continue;
      }

      const adamsJoint = /^JOINT\/(\d+)\s*,\s*([A-Za-z]+)(.*)$/i.exec(t);
      if (adamsJoint) {
        const jId = `JOINT_${adamsJoint[1]}`;
        const jType = adamsJoint[2]!.toLowerCase();
        const rest = adamsJoint[3]!;
        const mI = /\bI\s*=\s*(\d+)/i.exec(rest)?.[1];
        const mJ = /\bJ\s*=\s*(\d+)/i.exec(rest)?.[1];
        const child = (mI && markerToPart.get(mI)) || `M_${mI ?? "1"}`;
        const parent = (mJ && markerToPart.get(mJ)) || `M_${mJ ?? "0"}`;
        joints.push({
          name: jId,
          type: jType,
          parent,
          child,
          dof: JOINT_DOF[jType] ?? 1,
          line: i + 1,
        });
        continue;
      }

      // GENSYS: mass m_carbody 0.0 0.0 -1.2 m=32000 Jx=45000 Jy=850000 Jz=850000
      const gensysMass = /^mass\s+([A-Za-z0-9_]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)(.*)$/i.exec(t);
      if (gensysMass) {
        const rest = gensysMass[5]!;
        bodies.push({
          name: gensysMass[1]!,
          mass: Number(/\bm\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0),
          com: [Number(gensysMass[2]), Number(gensysMass[3]), Number(gensysMass[4])],
          ixx: Number(/\bJx\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0),
          iyy: Number(/\bJy\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0),
          izz: Number(/\bJz\s*=\s*([0-9.eE+-]+)/i.exec(rest)?.[1] ?? 0),
          isGround: false,
          line: i + 1,
        });
        continue;
      }

      // SIMPACK body.id = '$B_...'
      const simpackBody = /^body\.id\s*=\s*['"]([^'"]+)['"]/i.exec(t);
      if (simpackBody) {
        bodies.push({
          name: simpackBody[1]!,
          mass: 1.0,
          com: [0, 0, 0],
          ixx: 0,
          iyy: 0,
          izz: 0,
          isGround: /ground|isys/i.test(simpackBody[1]!),
          line: i + 1,
        });
      }
    }
  }

  // Ensure referenced parent/child bodies are accounted for in N (including ground/base frame)
  const bodyNames = new Set(bodies.map((b) => b.name));
  for (const j of joints) {
    if (j.parent) bodyNames.add(j.parent);
    if (j.child) bodyNames.add(j.child);
  }
  const hasExplicitGround = bodies.some((b) => b.isGround) || joints.length > 0;
  const N = bodyNames.size > 0 ? bodyNames.size + (hasExplicitGround ? 0 : 1) : 0;
  const J = joints.length;
  const jointDofSum = joints.reduce((acc, j) => acc + j.dof, 0);

  // Spatial Grübler-Kutzbach formula: M = 6*(N - 1 - J) + sum(f_i)
  const grublerMobility = N === 0 ? 0 : 6 * (N - 1 - J) + jointDofSum;

  // Closed-loop check: undirected edges J >= N_connected or duplicate child link
  const seenChild = new Set<string>();
  let duplicateChild = false;
  for (const j of joints) {
    if (seenChild.has(j.child)) duplicateChild = true;
    seenChild.add(j.child);
  }
  const hasClosedLoops = duplicateChild || (N > 0 && J >= N);
  const totalMassKg = bodies.reduce((acc, b) => acc + b.mass, 0);

  return {
    bodies,
    joints,
    bodyCountWithGround: N,
    jointDofSum,
    grublerMobility,
    hasClosedLoops,
    totalMassKg,
  };
}

export const MultibodyInspector: React.FC<MultibodyInspectorProps> = ({ code, lines, colorMode, onRevealLine }) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"mobility" | "inertia" | "limits">("mobility");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const summary = useMemo(() => analyzeMultibodyKinematics(code, lines), [code, lines]);
  const { bodies, joints, bodyCountWithGround, jointDofSum, grublerMobility, hasClosedLoops, totalMassKg } = summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "mobility", label: `🦾 Grübler-Kutzbach Mobility (M = ${grublerMobility})` },
          { id: "inertia", label: `⚖️ Rigid Bodies & Inertia (${bodies.length})` },
          { id: "limits", label: `🧭 Joint Topology & Limits (${joints.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subView === "mobility" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
            Spatial Grübler-Kutzbach Mobility Formula: M = 6(N − 1 − J) + ∑ fᵢ
          </div>
          {bodyCountWithGround === 0 && joints.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No rigid bodies or kinematic joints found in the active document.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Rigid Bodies (N)</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{bodyCountWithGround}</div>
                <div style={{ fontSize: 10, color: textMuted }}>Including base/ground frame</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Kinematic Joints (J)</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{joints.length}</div>
                <div style={{ fontSize: 10, color: textMuted }}>∑ fᵢ = {jointDofSum} joint DOF</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Spatial Mobility (M)</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    fontFamily: "monospace",
                    color: grublerMobility >= 0 ? "#3fb950" : "#f0883e",
                  }}
                >
                  {grublerMobility} DOF
                </div>
                <div style={{ fontSize: 10, color: textMuted }}>
                  6({bodyCountWithGround} − 1 − {joints.length}) + {jointDofSum}
                </div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontSize: 11, color: textMuted }}>Graph Topology</div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: hasClosedLoops ? "#f0883e" : "#58a6ff",
                    marginTop: 4,
                  }}
                >
                  {hasClosedLoops ? "Closed Kinematic Loop" : "Open-Chain Tree"}
                </div>
                <div style={{ fontSize: 10, color: textMuted }}>Total Mass: {totalMassKg.toFixed(2)} kg</div>
              </div>
            </div>
          )}
        </div>
      )}

      {subView === "inertia" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Mass, Center of Mass & Principal Inertia Tensor Audit
          </div>
          {bodies.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No rigid-body mass/inertia records declared.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Body</th>
                  <th style={{ padding: "6px 8px" }}>Mass (kg)</th>
                  <th style={{ padding: "6px 8px" }}>COM [x, y, z] (m)</th>
                  <th style={{ padding: "6px 8px" }}>[Ixx, Iyy, Izz]</th>
                  <th style={{ padding: "6px 8px" }}>Triangle Inequality</th>
                </tr>
              </thead>
              <tbody>
                {bodies.map((b, idx) => {
                  const hasInertia = b.ixx > 0 || b.iyy > 0 || b.izz > 0;
                  const triangleOk =
                    !hasInertia ||
                    (b.ixx + b.iyy >= b.izz - 1e-9 && b.iyy + b.izz >= b.ixx - 1e-9 && b.izz + b.ixx >= b.iyy - 1e-9);
                  return (
                    <tr
                      key={idx}
                      onClick={() => onRevealLine?.(b.line, b.name)}
                      style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                    >
                      <td style={{ padding: "6px 8px", fontWeight: 700, color: "#58a6ff" }}>{b.name}</td>
                      <td style={{ padding: "6px 8px" }}>{b.isGround ? "Ground" : b.mass.toFixed(3)}</td>
                      <td style={{ padding: "6px 8px" }}>
                        [{b.com[0]}, {b.com[1]}, {b.com[2]}]
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        [{b.ixx}, {b.iyy}, {b.izz}]
                      </td>
                      <td style={{ padding: "6px 8px", color: triangleOk ? "#3fb950" : "#f85149", fontWeight: 600 }}>
                        {b.isGround ? "Fixed Frame" : triangleOk ? "✓ SPD Valid" : "⚠ Violates Iᵢ+Iⱼ ≥ Iₖ"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {subView === "limits" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Kinematic Joint Hierarchy & Travel Limits
          </div>
          {joints.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No kinematic joints declared.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {joints.map((j, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(j.line, j.name)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    fontFamily: "monospace",
                    gap: 10,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: textPrimary }}>{j.name}</span>
                    <span style={{ color: textMuted, marginLeft: 8 }}>
                      ({j.parent} → {j.child})
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ color: "#3fb950", fontWeight: 600 }}>
                      {j.type} ({j.dof} DOF)
                    </span>
                    <span style={{ color: textMuted }}>
                      {j.lower !== undefined && j.upper !== undefined
                        ? `[${j.lower}, ${j.upper}]${j.effort !== undefined ? ` τ≤${j.effort}` : ""}`
                        : "Unbounded"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
