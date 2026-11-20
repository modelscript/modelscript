// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applySplices,
  buildProjectModel,
  parsePscx,
  planPscadEdits,
  readDefinitionForm,
  type PscadEditOp,
} from "@modelscript/pscad";
import { Button, TextInput, Textarea } from "@primer/react";
import React, { useMemo, useState } from "react";

type PortSide = "left" | "right" | "top" | "bottom";
type WizardPort = { name: string; mode: "In" | "Out" | "Electrical"; dim: number; side: PortSide };
type WizardShape = {
  kind: "rect" | "line" | "circle" | "text";
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  r?: number;
  text?: string;
};
type WizardParam = {
  name: string;
  label: string;
  type: "Real" | "Integer" | "Text" | "Boolean";
  defaultValue: string;
  unit: string;
  cond: string;
  vis: string;
};

function parseGfxShapes(graphicsXml?: string): WizardShape[] {
  if (!graphicsXml) return [];
  const shapes: WizardShape[] = [];
  const gfxRegex = /<Gfx\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Gfx>)/gi;
  let m: RegExpExecArray | null;
  while ((m = gfxRegex.exec(graphicsXml)) !== null) {
    const attrsStr = m[1] ?? "";
    const inner = m[2] ?? "";
    const getA = (k: string): string | undefined => {
      const r = new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrsStr);
      return r?.[1];
    };
    const cls = (getA("classid") ?? "").toLowerCase();
    if (cls.includes("rectangle")) {
      shapes.push({
        kind: "rect",
        x: parseFloat(getA("x") ?? "-28") || 0,
        y: parseFloat(getA("y") ?? "-20") || 0,
        w: parseFloat(getA("w") ?? "56") || 40,
        h: parseFloat(getA("h") ?? "40") || 32,
      });
    } else if (cls.includes("line")) {
      shapes.push({
        kind: "line",
        x: parseFloat(getA("x1") ?? getA("x") ?? "-20") || 0,
        y: parseFloat(getA("y1") ?? getA("y") ?? "0") || 0,
        x2: parseFloat(getA("x2") ?? "20") || 20,
        y2: parseFloat(getA("y2") ?? "0") || 0,
      });
    } else if (cls.includes("ellipse") || cls.includes("circle")) {
      shapes.push({
        kind: "circle",
        x: parseFloat(getA("x") ?? "0") || 0,
        y: parseFloat(getA("y") ?? "0") || 0,
        r: (parseFloat(getA("w") ?? "24") || 24) / 2,
      });
    } else if (cls.includes("text")) {
      const txtMatch = /<param\b[^>]*name=["']text["'][^>]*value=["']([^"']*)["']/i.exec(inner);
      shapes.push({
        kind: "text",
        x: parseFloat(getA("x") ?? "0") || 0,
        y: parseFloat(getA("y") ?? "4") || 0,
        text: txtMatch?.[1] ?? "",
      });
    }
  }
  return shapes;
}

function cycleSide(side: PortSide): PortSide {
  if (side === "left") return "top";
  if (side === "top") return "right";
  if (side === "right") return "bottom";
  return "left";
}

function portPreviewCoords(
  pt: WizardPort,
  idx: number,
  sameSideCount: number,
  sameSideIdx: number,
): { x: number; y: number } {
  const spread = (sameSideIdx - (sameSideCount - 1) / 2) * 16;
  if (pt.side === "left") return { x: -54, y: Math.round(spread) || (idx === 0 ? 0 : spread) };
  if (pt.side === "right") return { x: 54, y: Math.round(spread) || (idx === 0 ? 0 : spread) };
  if (pt.side === "top") return { x: Math.round(spread), y: -36 };
  return { x: Math.round(spread), y: 36 };
}

export interface PscadComponentWizardModalProps {
  code: string;
  colorMode: "light" | "dark";
  onApplyCode: (nextCode: string) => void;
  onClose: () => void;
}

export const PscadComponentWizardModal: React.FC<PscadComponentWizardModalProps> = ({
  code,
  colorMode,
  onApplyCode,
  onClose,
}) => {
  const existingDefinitions = useMemo(() => {
    try {
      const model = buildProjectModel(code);
      const parsed = parsePscx(code);
      return Array.from(model.definitions.values())
        .filter((d) => d.name.toLowerCase() !== "main")
        .map((d) => ({
          modelDef: d,
          parsedDef: parsed.definitions?.get(d.name),
          form: readDefinitionForm(d),
        }));
    } catch {
      return [];
    }
  }, [code]);

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [selectedExisting, setSelectedExisting] = useState("");
  const [name, setName] = useState("CustomBlock");
  const [description, setDescription] = useState("User-defined PSCAD component");
  const [ports, setPorts] = useState<WizardPort[]>([
    { name: "In1", mode: "In", dim: 1, side: "left" },
    { name: "Out1", mode: "Out", dim: 1, side: "right" },
  ]);
  const [shapes, setShapes] = useState<WizardShape[]>([
    { kind: "rect", x: -40, y: -26, w: 80, h: 52 },
    { kind: "text", x: 0, y: 4, text: "USER" },
  ]);
  const [params, setParams] = useState<WizardParam[]>([
    { name: "K", label: "Gain", type: "Real", defaultValue: "1.0", unit: "", cond: "", vis: "" },
  ]);
  const [dsdyn, setDsdyn] = useState("$Out1 = $K * $In1;");

  const bg = colorMode === "dark" ? "#161b22" : "#ffffff";
  const subBg = colorMode === "dark" ? "#0d1117" : "#f6f8fa";
  const border = colorMode === "dark" ? "1px solid #30363d" : "1px solid #d0d7de";
  const strokeColor = colorMode === "dark" ? "#e6edf3" : "#1f2328";

  const loadExistingDefinition = (defName: string) => {
    const found = existingDefinitions.find((d) => d.modelDef.name === defName);
    if (!found) return;
    setSelectedExisting(defName);
    setName(found.modelDef.name);
    setDescription(found.parsedDef?.description ?? found.modelDef.name);
    setPorts(
      found.modelDef.ports.map((p) => {
        const side: PortSide =
          Math.abs(p.x) >= Math.abs(p.y) ? (p.x < 0 ? "left" : "right") : p.y < 0 ? "top" : "bottom";
        const ptMode: "In" | "Out" | "Electrical" = p.mode === 2 ? "Out" : p.mode === 1 ? "In" : "Electrical";
        return { name: p.name, mode: ptMode, dim: p.dim || 1, side };
      }),
    );
    const parsedShapes = parseGfxShapes(found.parsedDef?.graphicsXml);
    setShapes(
      parsedShapes.length > 0
        ? parsedShapes
        : [
            { kind: "rect", x: -40, y: -26, w: 80, h: 52 },
            { kind: "text", x: 0, y: 4, text: found.modelDef.name },
          ],
    );
    const loadedParams: WizardParam[] = [];
    for (const cat of found.form?.categories ?? []) {
      for (const p of cat.parameters) {
        const t = p.type === "Integer" || p.type === "Text" || p.type === "Boolean" ? p.type : ("Real" as const);
        loadedParams.push({
          name: p.name,
          label: p.label,
          type: t,
          defaultValue: p.defaultValue,
          unit: p.unit,
          cond: p.cond,
          vis: p.vis,
        });
      }
    }
    setParams(loadedParams);
    setDsdyn(found.parsedDef?.scriptSegments?.get("dsdyn")?.content ?? "");
  };

  const handleSave = () => {
    const cleanName = (mode === "edit" && selectedExisting ? selectedExisting : name).trim() || "CustomBlock";
    const resolvedPorts = ports.map((pt, idx) => {
      const sameSide = ports.filter((other) => other.side === pt.side);
      const sameIdx = sameSide.indexOf(pt);
      const pos = portPreviewCoords(pt, idx, sameSide.length, sameIdx);
      return { name: pt.name, mode: pt.mode, dim: pt.dim, side: pt.side, x: pos.x, y: pos.y };
    });
    const op: PscadEditOp = {
      type: mode === "edit" && selectedExisting ? "updateDefinition" : "addDefinition",
      name: cleanName,
      description: description.trim(),
      ports: resolvedPorts,
      shapes,
      parameters: params.map((p) => ({
        name: p.name,
        label: p.label,
        type: p.type,
        defaultValue: p.defaultValue,
        unit: p.unit,
        cond: p.cond.trim() || undefined,
        vis: p.vis.trim() || undefined,
      })),
      dsdyn: dsdyn.trim() || undefined,
    };
    const plan = planPscadEdits(code, [op]);
    if (plan.splices.length > 0) {
      onApplyCode(applySplices(code, plan.splices));
    }
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 700,
          maxWidth: "96vw",
          maxHeight: "92vh",
          overflowY: "auto",
          backgroundColor: bg,
          border,
          borderRadius: 12,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>PSCAD Visual Component Workshop (&lt;Definition&gt;)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button
              size="small"
              variant={mode === "create" ? "primary" : "default"}
              onClick={() => {
                setMode("create");
                setSelectedExisting("");
              }}
            >
              Create New
            </Button>
            {existingDefinitions.length > 0 && (
              <Button
                size="small"
                variant={mode === "edit" ? "primary" : "default"}
                onClick={() => {
                  setMode("edit");
                  const first = selectedExisting || existingDefinitions[0]!.modelDef.name;
                  loadExistingDefinition(first);
                }}
              >
                Edit Existing
              </Button>
            )}
            <Button size="small" variant="invisible" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>

        {mode === "edit" && existingDefinitions.length > 0 && (
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Target &lt;Definition&gt;:</span>
            <select
              value={selectedExisting}
              onChange={(e) => loadExistingDefinition(e.target.value)}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 6,
                flex: 1,
                background: subBg,
                color: "inherit",
                border,
              }}
            >
              {existingDefinitions.map((d) => (
                <option key={d.modelDef.name} value={d.modelDef.name}>
                  {d.modelDef.name} ({d.modelDef.ports.length} ports)
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 11 }}>
            Definition Name
            <TextInput
              value={name}
              disabled={mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              size="small"
              block
            />
          </label>
          <label style={{ fontSize: 11 }}>
            Description
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} size="small" block />
          </label>
        </div>

        {/* Interactive Vector Symbol & Port Preview */}
        <div
          style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10, border, borderRadius: 8, padding: 10 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Icon Preview (click pin to rotate side)</span>
            <svg
              width={190}
              height={120}
              viewBox="-80 -50 160 100"
              style={{ border, borderRadius: 6, background: subBg }}
              aria-label="Component symbol preview"
            >
              <line x1={-80} y1={0} x2={80} y2={0} stroke="rgba(128,128,128,0.18)" strokeWidth={0.5} />
              <line x1={0} y1={-50} x2={0} y2={50} stroke="rgba(128,128,128,0.18)" strokeWidth={0.5} />
              {shapes.map((s, idx) => {
                if (s.kind === "rect") {
                  return (
                    <rect
                      key={idx}
                      x={s.x}
                      y={s.y}
                      width={s.w ?? 40}
                      height={s.h ?? 32}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                if (s.kind === "line") {
                  return (
                    <line
                      key={idx}
                      x1={s.x}
                      y1={s.y}
                      x2={s.x2 ?? s.x + 20}
                      y2={s.y2 ?? s.y}
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                if (s.kind === "circle") {
                  return (
                    <circle
                      key={idx}
                      cx={s.x}
                      cy={s.y}
                      r={s.r ?? 12}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                return (
                  <text
                    key={idx}
                    x={s.x}
                    y={s.y}
                    textAnchor="middle"
                    fontSize={9}
                    fill={strokeColor}
                    fontFamily="monospace"
                  >
                    {s.text ?? ""}
                  </text>
                );
              })}
              {ports.map((pt, idx) => {
                const sameSide = ports.filter((other) => other.side === pt.side);
                const sameIdx = sameSide.indexOf(pt);
                const pos = portPreviewCoords(pt, idx, sameSide.length, sameIdx);
                const pinColor = pt.mode === "Out" ? "#3fb950" : pt.mode === "Electrical" ? "#f59e0b" : "#38bdf8";
                return (
                  <g
                    key={idx}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, side: cycleSide(x.side) } : x)))
                    }
                  >
                    <circle cx={pos.x} cy={pos.y} r={3.5} fill={pinColor} />
                    <text
                      x={pt.side === "left" ? pos.x - 5 : pt.side === "right" ? pos.x + 5 : pos.x}
                      y={pt.side === "top" ? pos.y - 5 : pt.side === "bottom" ? pos.y + 9 : pos.y + 2}
                      textAnchor={pt.side === "left" ? "end" : pt.side === "right" ? "start" : "middle"}
                      fontSize={7}
                      fill={pinColor}
                    >
                      {pt.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>Vector Symbol (&lt;Gfx&gt;)</span>
              <div style={{ display: "flex", gap: 4 }}>
                <Button
                  size="small"
                  onClick={() => setShapes((s) => [...s, { kind: "rect", x: -24, y: -16, w: 48, h: 32 }])}
                >
                  + Rect
                </Button>
                <Button
                  size="small"
                  onClick={() => setShapes((s) => [...s, { kind: "line", x: -20, y: 0, x2: 20, y2: 0 }])}
                >
                  + Line
                </Button>
                <Button size="small" onClick={() => setShapes((s) => [...s, { kind: "circle", x: 0, y: 0, r: 12 }])}>
                  + Circle
                </Button>
                <Button
                  size="small"
                  onClick={() => setShapes((s) => [...s, { kind: "text", x: 0, y: 4, text: name || "SYM" }])}
                >
                  + Text
                </Button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 110, overflowY: "auto" }}>
              {shapes.map((sh, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr 1fr 1fr 1fr auto",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontSize: 10 }}>{sh.kind}</span>
                  <TextInput
                    size="small"
                    type="number"
                    aria-label="shape x"
                    value={String(sh.x)}
                    onChange={(e) =>
                      setShapes((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, x: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                  <TextInput
                    size="small"
                    type="number"
                    aria-label="shape y"
                    value={String(sh.y)}
                    onChange={(e) =>
                      setShapes((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, y: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                  {sh.kind === "rect" ? (
                    <>
                      <TextInput
                        size="small"
                        type="number"
                        aria-label="shape w"
                        value={String(sh.w ?? 40)}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, w: Number(e.target.value) || 10 } : x)),
                          )
                        }
                      />
                      <TextInput
                        size="small"
                        type="number"
                        aria-label="shape h"
                        value={String(sh.h ?? 32)}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, h: Number(e.target.value) || 10 } : x)),
                          )
                        }
                      />
                    </>
                  ) : sh.kind === "line" ? (
                    <>
                      <TextInput
                        size="small"
                        type="number"
                        aria-label="shape x2"
                        value={String(sh.x2 ?? 20)}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, x2: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                      <TextInput
                        size="small"
                        type="number"
                        aria-label="shape y2"
                        value={String(sh.y2 ?? 0)}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, y2: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                    </>
                  ) : sh.kind === "circle" ? (
                    <>
                      <TextInput
                        size="small"
                        type="number"
                        aria-label="circle radius"
                        value={String(sh.r ?? 12)}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, r: Math.max(2, Number(e.target.value) || 12) } : x,
                            ),
                          )
                        }
                      />
                      <span />
                    </>
                  ) : (
                    <>
                      <TextInput
                        size="small"
                        aria-label="label text"
                        value={sh.text ?? ""}
                        onChange={(e) =>
                          setShapes((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))
                        }
                      />
                      <span />
                    </>
                  )}
                  <Button
                    size="small"
                    variant="invisible"
                    onClick={() => setShapes((s) => s.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ports with Edge Side */}
        <div style={{ border, borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Ports (&lt;port&gt;)</span>
            <Button
              size="small"
              onClick={() => setPorts((p) => [...p, { name: `P${p.length + 1}`, mode: "In", dim: 1, side: "left" }])}
            >
              + Port
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ports.map((pt, idx) => (
              <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <TextInput
                  size="small"
                  value={pt.name}
                  onChange={(e) =>
                    setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <select
                  value={pt.mode}
                  onChange={(e) =>
                    setPorts((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, mode: e.target.value as "In" | "Out" | "Electrical" } : x,
                      ),
                    )
                  }
                  style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6 }}
                >
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                  <option value="Electrical">Electrical</option>
                </select>
                <select
                  value={pt.side}
                  aria-label="Port side"
                  onChange={(e) =>
                    setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, side: e.target.value as PortSide } : x)))
                  }
                  style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6 }}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
                <Button size="small" variant="invisible" onClick={() => setPorts((p) => p.filter((_, i) => i !== idx))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Form Parameters with Conditional Visibility Rules */}
        <div style={{ border, borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Parameters (&lt;form&gt; with cond/vis rules)</span>
            <Button
              size="small"
              onClick={() =>
                setParams((p) => [
                  ...p,
                  {
                    name: `P${p.length + 1}`,
                    label: `Param ${p.length + 1}`,
                    type: "Real",
                    defaultValue: "0",
                    unit: "",
                    cond: "",
                    vis: "",
                  },
                ])
              }
            >
              + Param
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {params.map((pm, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 74px 60px 1fr 1fr auto", gap: 4 }}
              >
                <TextInput
                  size="small"
                  placeholder="Name"
                  value={pm.name}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <TextInput
                  size="small"
                  placeholder="Default"
                  value={pm.defaultValue}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, defaultValue: e.target.value } : x)))
                  }
                />
                <select
                  value={pm.type}
                  onChange={(e) =>
                    setParams((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, type: e.target.value as "Real" | "Integer" | "Text" | "Boolean" } : x,
                      ),
                    )
                  }
                  style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6 }}
                >
                  <option value="Real">Real</option>
                  <option value="Integer">Integer</option>
                  <option value="Text">Text</option>
                  <option value="Boolean">Boolean</option>
                </select>
                <TextInput
                  size="small"
                  placeholder="Unit"
                  value={pm.unit}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))
                  }
                />
                <TextInput
                  size="small"
                  placeholder="cond (e.g. Mode==1)"
                  value={pm.cond}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, cond: e.target.value } : x)))
                  }
                />
                <TextInput
                  size="small"
                  placeholder="vis rule"
                  value={pm.vis}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, vis: e.target.value } : x)))
                  }
                />
                <Button
                  size="small"
                  variant="invisible"
                  onClick={() => setParams((p) => p.filter((_, i) => i !== idx))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>

        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
          Dsdyn Equation / Script
          <Textarea
            rows={3}
            value={dsdyn}
            onChange={(e) => setDsdyn(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 11 }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="primary" onClick={handleSave}>
            {mode === "edit" && selectedExisting ? "Update <Definition>" : "Insert <Definition>"}
          </Button>
        </div>
      </div>
    </div>
  );
};
