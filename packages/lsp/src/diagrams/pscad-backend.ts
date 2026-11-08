// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextEdit } from "vscode-languageserver";
import { deduplicateAndSort, type DiagramBackend, type DiagramDispatchDeps } from "../diagramApi.js";
import type {
  ComponentPropertyData,
  DiagramApplyEditsParams,
  DiagramApplyEditsResult,
  DiagramData,
  DiagramDrillDownParams,
  DiagramDrillDownResult,
  DiagramGetComponentPropertiesParams,
  DiagramGetDataParams,
  DiagramPalette,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
} from "../diagramProtocol.js";

export function createPscadDiagramBackend(backends: DiagramDispatchDeps): DiagramBackend {
  const readPscxSource = async (targetUri: string): Promise<string | null> => {
    const memText =
      (backends.generic as any)?.deps?.getDocumentText?.(targetUri) ??
      (backends.modelica as any)?.deps?.getDocumentText?.(targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs errors
    }
    return null;
  };

  const formatDiagramData = (rawDiagram: any): DiagramData => {
    const nodes = rawDiagram.cells.filter((c: any) => c.shape !== "edge");
    const edges = rawDiagram.cells.filter((c: any) => c.shape === "edge");
    return {
      nodes,
      edges,
      coordinateSystem: null,
      diagramBackground: null,
      cells: rawDiagram.cells,
      metadata: rawDiagram.metadata,
    } as any;
  };

  return {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx } = await import("@modelscript/pscad");
        const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
        const project = parsePscx(text);
        const rawDiagram = buildPscadDiagram(project, params.className);
        return formatDiagramData(rawDiagram);
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx, getMasterComponentSchema, getUserDefinitionForm } = await import("@modelscript/pscad");
        const project = parsePscx(text);
        const mod =
          params.className && project.subModules.has(params.className)
            ? project.subModules.get(params.className)!
            : project.rootModule;

        const rawName = params.componentName;
        const strippedCmpId = rawName.startsWith("cmp_") ? rawName.slice(4) : rawName;
        const strippedBusId = rawName.startsWith("bus_") ? rawName.slice(4) : rawName;

        const allMods = [project.rootModule, ...Array.from(project.subModules.values())];
        const cmp =
          mod.components.find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName) ??
          allMods
            .flatMap((m) => m.components)
            .find((c) => c.id === strippedCmpId || c.id === rawName || c.instanceName === rawName);

        if (cmp) {
          const masterSchema = getMasterComponentSchema(cmp.definitionName);
          const mergedValues: Record<string, any> = {};
          if (masterSchema) {
            for (const p of masterSchema.parameters) {
              mergedValues[p.key] = p.defaultValue;
            }
          }
          for (const [k, v] of Object.entries(cmp.parameters)) {
            mergedValues[k] = v;
          }

          const parameters: ComponentPropertyData["parameters"] = [];
          const tabs: PropertyTabConfig[] = [];

          if (masterSchema) {
            const seenKeys = new Set<string>();
            const tabMap = new Map<string, Map<string, PropertyFieldConfig[]>>();

            for (const p of masterSchema.parameters) {
              seenKeys.add(p.key);
              const currentVal = mergedValues[p.key] ?? p.defaultValue;
              parameters.push({
                name: p.key,
                localizedName: p.label,
                value: String(currentVal),
                defaultValue: String(p.defaultValue),
                description: p.description,
                unit: p.unit,
                tab: p.tab,
                group: p.group || "Configuration",
              });

              const tabName = p.tab || "General";
              const groupName = p.group || "Configuration";
              if (!tabMap.has(tabName)) tabMap.set(tabName, new Map());
              const groupMap = tabMap.get(tabName)!;
              if (!groupMap.has(groupName)) groupMap.set(groupName, []);

              const field: PropertyFieldConfig = {
                key: p.key,
                label: p.label,
                kind: p.kind === "select" ? "choice" : p.kind,
                description: p.description,
                defaultValue: p.defaultValue,
                unit: p.unit,
                choices: p.options?.map((o) => ({ label: o.label, value: o.value })),
                validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
              };
              groupMap.get(groupName)!.push(field);
            }

            // Include any additional instance-specific parameters not in the catalog schema
            for (const [k, v] of Object.entries(cmp.parameters)) {
              if (seenKeys.has(k)) continue;
              parameters.push({
                name: k,
                value: String(v),
                description: `PSCAD parameter '${k}'`,
                tab: "General",
                group: "Instance Parameters",
              });
              if (!tabMap.has("General")) tabMap.set("General", new Map());
              const gMap = tabMap.get("General")!;
              if (!gMap.has("Instance Parameters")) gMap.set("Instance Parameters", []);
              gMap.get("Instance Parameters")!.push({
                key: k,
                label: k,
                kind: typeof v === "number" ? "number" : "string",
                defaultValue: v,
              });
            }

            for (const [tabLabel, groupMap] of tabMap.entries()) {
              const groups: PropertyGroupConfig[] = [];
              for (const [groupLabel, fields] of groupMap.entries()) {
                groups.push({
                  id: groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  label: groupLabel,
                  fields,
                });
              }
              tabs.push({
                id: tabLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                label: tabLabel,
                groups,
              });
            }
          } else if (getUserDefinitionForm(text, cmp.definitionName)) {
            const form = getUserDefinitionForm(text, cmp.definitionName)!;
            const seenKeys = new Set<string>();
            for (const cat of form.categories) {
              if (!cat.visible) continue;
              const fields: PropertyFieldConfig[] = [];
              for (const p of cat.parameters) {
                seenKeys.add(p.name);
                const current = cmp.parameters[p.name];
                const value = current !== undefined ? String(current) : p.defaultValue;
                const numeric =
                  (p.type === "Real" || p.type === "Integer") && value.trim() !== "" && !isNaN(Number(value));
                parameters.push({
                  name: p.name,
                  localizedName: p.label,
                  value,
                  defaultValue: p.defaultValue,
                  description: p.help || p.label,
                  unit: p.unit || undefined,
                  tab: cat.name,
                  group: cat.name,
                });
                fields.push({
                  key: p.name,
                  label: p.label,
                  kind: numeric ? "number" : "string",
                  description: p.help || undefined,
                  defaultValue: numeric ? Number(p.defaultValue) : p.defaultValue,
                  unit: p.unit || undefined,
                  validation: p.min !== undefined || p.max !== undefined ? { min: p.min, max: p.max } : undefined,
                });
              }
              if (fields.length > 0) {
                tabs.push({
                  id: cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  label: cat.name,
                  groups: [{ id: "parameters", label: cat.name, fields }],
                });
              }
            }
            // Instance parameters the definition's form does not declare (e.g. Name, hidden defaults).
            const extra = Object.entries(cmp.parameters).filter(([k]) => !seenKeys.has(k));
            if (extra.length > 0) {
              tabs.push({
                id: "instance",
                label: "Instance",
                groups: [
                  {
                    id: "instance_parameters",
                    label: "Instance Parameters",
                    fields: extra.map(([k, v]) => {
                      parameters.push({ name: k, value: String(v), description: `PSCAD parameter '${k}'` });
                      return {
                        key: k,
                        label: k,
                        kind: typeof v === "number" ? ("number" as const) : ("string" as const),
                        defaultValue: v,
                      };
                    }),
                  },
                ],
              });
            }
          } else {
            const fields: PropertyFieldConfig[] = Object.entries(cmp.parameters).map(([k, v]) => {
              parameters.push({
                name: k,
                value: String(v),
                description: `PSCAD parameter '${k}'`,
              });
              return {
                key: k,
                label: k,
                kind: typeof v === "number" ? "number" : "string",
                defaultValue: v,
              };
            });
            tabs.push({
              id: "general",
              label: "General",
              groups: [{ id: "configuration", label: "Configuration", fields }],
            });
          }

          return {
            classKind: "component",
            className: cmp.definitionName,
            localizedClassName: masterSchema?.label,
            name: cmp.instanceName || cmp.id,
            description: masterSchema?.description || `PSCAD ${cmp.definitionName} (${cmp.id})`,
            parameters,
            schema: {
              title: masterSchema?.label || cmp.instanceName || cmp.definitionName,
              tabs,
            },
            values: mergedValues,
          };
        }

        const bus =
          mod.buses.find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName) ??
          allMods.flatMap((m) => m.buses).find((b) => b.id === strippedBusId || b.id === rawName || b.name === rawName);
        if (bus) {
          return {
            classKind: "bus",
            className: "Bus",
            name: bus.name,
            description: `PSCAD Electrical Bus (${bus.phaseCount}-phase)`,
            parameters: [
              { name: "Name", value: bus.name, description: "Bus identifier" },
              {
                name: "BaseKV",
                value: String(bus.voltageBaseKv ?? 230.0),
                unit: "kV",
                description: "Base line-to-line RMS voltage",
              },
            ],
            schema: {
              title: `3-Phase Electrical Bus (${bus.name})`,
              tabs: [
                {
                  id: "general",
                  label: "General",
                  groups: [
                    {
                      id: "ratings",
                      label: "Bus Ratings",
                      fields: [
                        { key: "Name", label: "Bus Name", kind: "string", defaultValue: bus.name },
                        {
                          key: "BaseKV",
                          label: "Base Voltage (L-L RMS)",
                          kind: "number",
                          unit: "kV",
                          defaultValue: bus.voltageBaseKv ?? 230.0,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            values: {
              Name: bus.name,
              BaseKV: bus.voltageBaseKv ?? 230.0,
            },
          };
        }
      } catch {
        return null;
      }
      return null;
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return { seq: params.seq, edits: [], renderHint: "none" };
        const { parsePscx, buildComponentXmlSnippet, planDiagramActions } = await import("@modelscript/pscad");
        // Preferred path: structural edits on the lossless XML tree. If an action references something
        // the model cannot resolve, fall back to the legacy line-based logic below.
        try {
          const planned = planDiagramActions(text, params.actions as never);
          if (planned.unresolved.length === 0) {
            return { seq: params.seq, edits: planned.edits as TextEdit[], renderHint: planned.renderHint };
          }
        } catch {
          // fall through to legacy path
        }
        const project = parsePscx(text);
        const lines = text.split("\n");
        const allEdits: TextEdit[] = [];
        let renderHint: "none" | "immediate" | "debounced" = "none";

        const allComponents = [
          ...project.rootModule.components,
          ...Array.from(project.subModules.values()).flatMap((m) => m.components),
        ];
        const allBuses = [
          ...project.rootModule.buses,
          ...Array.from(project.subModules.values()).flatMap((m) => m.buses),
        ];
        const allWires = [
          ...project.rootModule.wires,
          ...Array.from(project.subModules.values()).flatMap((m) => m.wires),
        ];

        const stripPrefix = (raw: string) =>
          raw.startsWith("cmp_") || raw.startsWith("bus_")
            ? raw.slice(4)
            : raw.startsWith("wire_")
              ? raw.slice(5)
              : raw;

        const findSchematicEndLine = (sectionName?: string): number => {
          if (sectionName) {
            const defLineIdx = lines.findIndex(
              (l) => /<Definition\b/i.test(l) && new RegExp(`name\\s*=\\s*["']${sectionName}["']`, "i").test(l),
            );
            if (defLineIdx >= 0) {
              for (let i = defLineIdx; i < lines.length; i++) {
                if (/<\/schematic>/i.test(lines[i]!)) return i;
                if (/<\/Definition>/i.test(lines[i]!)) return i;
              }
            }
          }
          for (let i = lines.length - 1; i >= 0; i--) {
            if (/<\/schematic>/i.test(lines[i]!)) return i;
          }
          for (let i = lines.length - 1; i >= 0; i--) {
            if (/<\/project>/i.test(lines[i]!)) return i;
          }
          return Math.max(0, lines.length - 1);
        };

        const resolveEndpointCoords = (
          cellOrPortId: string,
          explicitPortName?: string,
        ): { x: number; y: number } | null => {
          const cleanId = stripPrefix(cellOrPortId);
          const cmp = allComponents.find(
            (c) =>
              c.id === cleanId ||
              c.id === cellOrPortId ||
              c.instanceName === cellOrPortId ||
              c.ports.some((p) => p.id === cellOrPortId || p.id === cleanId),
          );
          if (cmp) {
            const matchedPort =
              (explicitPortName
                ? cmp.ports.find(
                    (p) =>
                      p.name === explicitPortName ||
                      p.id === explicitPortName ||
                      p.id === `${cmp.id}_${explicitPortName}`,
                  )
                : undefined) ??
              cmp.ports.find((p) => p.id === cellOrPortId || p.id === cleanId) ??
              cmp.ports[0];
            if (matchedPort) {
              const rotRad = (((cmp.rotation ?? 0) % 360) * Math.PI) / 180;
              const cos = Math.round(Math.cos(rotRad) * 1e6) / 1e6;
              const sin = Math.round(Math.sin(rotRad) * 1e6) / 1e6;
              const lx = cmp.mirror ? -matchedPort.position.x : matchedPort.position.x;
              const ly = matchedPort.position.y;
              return {
                x: Math.round(cmp.position.x + (lx * cos - ly * sin)),
                y: Math.round(cmp.position.y + (lx * sin + ly * cos)),
              };
            }
            return { x: Math.round(cmp.position.x), y: Math.round(cmp.position.y) };
          }
          const bus = allBuses.find((b) => b.id === cleanId || b.id === cellOrPortId || b.name === cellOrPortId);
          if (bus) {
            return { x: Math.round(bus.position.x), y: Math.round(bus.position.y) };
          }
          return null;
        };

        const hasPositiveY =
          allComponents.some((c) => c.position.y > 0) ||
          allBuses.some((b) => b.position.y > 0) ||
          allWires.some((w) => w.vertices.some((v) => v.y > 0));
        const normalizeWirePt = (pt: { x: number; y: number }): { x: number; y: number } => ({
          x: Math.round(pt.x),
          y: Math.round(hasPositiveY && pt.y < 0 ? Math.abs(pt.y) : pt.y),
        });

        const parseEndpointTokens = (ep: string): string[] => {
          const raw = ep.trim();
          const tokens = new Set<string>([raw, stripPrefix(raw)]);
          if (raw.includes(".")) {
            const [cellPart, portPart] = raw.split(".", 2);
            if (cellPart) {
              tokens.add(cellPart);
              tokens.add(stripPrefix(cellPart));
            }
            if (portPart) {
              tokens.add(portPart);
              tokens.add(stripPrefix(portPart));
            }
          }
          return [...tokens];
        };

        const wireMatchesEndpoint = (w: (typeof allWires)[number], ep: string): boolean => {
          const tokens = parseEndpointTokens(ep);
          if (tokens.some((t) => w.id === t || `wire_${w.id}` === t)) return true;
          if (w.startPortId && tokens.some((t) => w.startPortId === t || stripPrefix(w.startPortId!) === t)) {
            return true;
          }
          if (w.endPortId && tokens.some((t) => w.endPortId === t || stripPrefix(w.endPortId!) === t)) {
            return true;
          }
          return w.connectedPortIds.some((pid) =>
            tokens.some((t) => pid === t || pid.startsWith(`${t}_`) || stripPrefix(pid) === t),
          );
        };

        const findMatchingWire = (src: string, dst: string) =>
          allWires.find((w) => {
            if (w.id === src || w.id === stripPrefix(src) || `wire_${w.id}` === src) return true;
            return wireMatchesEndpoint(w, src) && wireMatchesEndpoint(w, dst);
          });

        const editedWireIds = new Set<string>();
        const rewriteWireVertices = (w: (typeof allWires)[number], pts: { x: number; y: number }[]) => {
          if (!w.line || w.line - 1 >= lines.length || editedWireIds.has(w.id)) return;
          editedWireIds.add(w.id);
          const startLine = w.line - 1;
          let endLine = startLine;
          while (endLine < lines.length && !/<\/Wire>/i.test(lines[endLine]!)) {
            endLine++;
          }
          const openLine = lines[startLine]!;
          const indent = /^(\s*)/.exec(openLine)?.[1] ?? "          ";
          const vertexLines = pts
            .map((pt) => {
              const np = normalizeWirePt(pt);
              return `${indent}  <vertex x="${np.x}" y="${np.y}" />`;
            })
            .join("\n");
          const replacement = `${openLine}\n${vertexLines}\n${indent}</Wire>`;
          allEdits.push({
            range: {
              start: { line: startLine, character: 0 },
              end: { line: endLine, character: lines[endLine]?.length ?? 0 },
            },
            newText: replacement,
          });
        };

        for (const action of params.actions) {
          if (action.type === "move") {
            for (const item of action.items) {
              const strippedId = stripPrefix(item.name);
              const cmp = allComponents.find(
                (c) => c.id === strippedId || c.id === item.name || c.instanceName === item.name,
              );
              const targetLineIdx = cmp?.line ? cmp.line - 1 : -1;
              const newX = Math.round(item.width > 0 ? item.x + item.width / 2 : item.x);
              const newY = Math.round(item.height > 0 ? item.y + item.height / 2 : item.y);

              if (targetLineIdx >= 0 && targetLineIdx < lines.length && cmp) {
                const lineText = lines[targetLineIdx]!;
                let updatedLine = lineText
                  .replace(/\bx\s*=\s*(["'])[^"']*\1/i, `x=$1${newX}$1`)
                  .replace(/\by\s*=\s*(["'])[^"']*\1/i, `y=$1${newY}$1`);
                if (item.rotation !== undefined) {
                  const deg = ((Math.round(item.rotation) % 360) + 360) % 360;
                  const orientCode = deg % 90 === 0 ? (deg / 90) % 4 : deg;
                  if (/\borient\s*=\s*["'][^"']*["']/i.test(updatedLine)) {
                    updatedLine = updatedLine.replace(/\borient\s*=\s*(["'])[^"']*\1/i, `orient=$1${orientCode}$1`);
                  } else {
                    updatedLine = updatedLine.replace(/(\s*\/?>)\s*$/, ` orient="${orientCode}"$1`);
                  }
                }
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: targetLineIdx, character: 0 },
                      end: { line: targetLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                }

                // Update connected wire vertices from item.edges or rubber-band snapped endpoints
                if (item.edges && item.edges.length > 0) {
                  for (const edge of item.edges) {
                    if (!edge.points || edge.points.length < 2) continue;
                    const matched = findMatchingWire(edge.source, edge.target);
                    if (matched) {
                      rewriteWireVertices(matched, edge.points);
                    }
                  }
                }
                const dx = newX - cmp.position.x;
                const dy = newY - cmp.position.y;
                if (dx !== 0 || dy !== 0) {
                  const cmpPortIds = new Set(cmp.ports.map((p) => p.id));
                  for (const w of allWires) {
                    if (editedWireIds.has(w.id) || w.vertices.length < 2) continue;
                    const startAttached = Boolean(w.startPortId && cmpPortIds.has(w.startPortId));
                    const endAttached = Boolean(w.endPortId && cmpPortIds.has(w.endPortId));
                    if (!startAttached && !endAttached) continue;
                    const updatedPts = w.vertices.map((v, idx) => {
                      if (idx === 0 && startAttached) return { x: v.x + dx, y: v.y + dy };
                      if (idx === w.vertices.length - 1 && endAttached) return { x: v.x + dx, y: v.y + dy };
                      return { x: v.x, y: v.y };
                    });
                    rewriteWireVertices(w, updatedPts);
                  }
                }
              } else {
                const bus = allBuses.find((b) => b.id === strippedId || b.id === item.name || b.name === item.name);
                if (bus?.line && bus.line - 1 < lines.length) {
                  const bLineIdx = bus.line - 1;
                  const lineText = lines[bLineIdx]!;
                  // Buses are left-aligned horizontally at bus.position.x
                  const busX = Math.round(item.x);
                  const busY = Math.round(item.height > 0 && item.height <= 16 ? item.y + item.height / 2 : item.y);
                  const updatedLine = lineText
                    .replace(/\bx\s*=\s*(["'])[^"']*\1/i, `x=$1${busX}$1`)
                    .replace(/\by\s*=\s*(["'])[^"']*\1/i, `y=$1${busY}$1`);
                  if (updatedLine !== lineText) {
                    allEdits.push({
                      range: {
                        start: { line: bLineIdx, character: 0 },
                        end: { line: bLineIdx, character: lineText.length },
                      },
                      newText: updatedLine,
                    });
                  }
                }
              }
            }
          } else if (action.type === "rotate") {
            const strippedId = stripPrefix(action.item.name);
            const cmp = allComponents.find(
              (c) => c.id === strippedId || c.id === action.item.name || c.instanceName === action.item.name,
            );
            if (cmp?.line && cmp.line - 1 < lines.length) {
              const lineIdx = cmp.line - 1;
              const lineText = lines[lineIdx]!;
              const deg = ((Math.round(action.item.rotation ?? 0) % 360) + 360) % 360;
              const orientCode = deg % 90 === 0 ? (deg / 90) % 4 : deg;
              let updatedLine = lineText;
              if (/\borient\s*=\s*["'][^"']*["']/i.test(lineText)) {
                updatedLine = lineText.replace(/\borient\s*=\s*(["'])[^"']*\1/i, `orient=$1${orientCode}$1`);
              } else {
                updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` orient="${orientCode}"$1`);
              }
              if (updatedLine !== lineText) {
                allEdits.push({
                  range: {
                    start: { line: lineIdx, character: 0 },
                    end: { line: lineIdx, character: lineText.length },
                  },
                  newText: updatedLine,
                });
                renderHint = "immediate";
              }
            }
          } else if (action.type === "resize") {
            const strippedId = stripPrefix(action.item.name);
            const bus = allBuses.find(
              (b) => b.id === strippedId || b.id === action.item.name || b.name === action.item.name,
            );
            if (bus?.line && bus.line - 1 < lines.length) {
              const bLineIdx = bus.line - 1;
              const lineText = lines[bLineIdx]!;
              const newLen = Math.max(20, Math.round(Math.max(action.item.width || 0, action.item.height || 0)));
              let updatedLine = lineText;
              if (/\blength\s*=\s*["'][^"']*["']/i.test(lineText)) {
                updatedLine = lineText.replace(/\blength\s*=\s*(["'])[^"']*\1/i, `length=$1${newLen}$1`);
              } else {
                updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` length="${newLen}"$1`);
              }
              if (updatedLine !== lineText) {
                allEdits.push({
                  range: {
                    start: { line: bLineIdx, character: 0 },
                    end: { line: bLineIdx, character: lineText.length },
                  },
                  newText: updatedLine,
                });
                renderHint = "immediate";
              }
            }
          } else if (action.type === "updateParameter" || action.type === "updateProperty") {
            const paramName = action.type === "updateProperty" ? action.key : action.parameter;
            const paramVal = String(action.value);
            const strippedId = stripPrefix(action.name);
            const cmp = allComponents.find(
              (c) => c.id === strippedId || c.id === action.name || c.instanceName === action.name,
            );
            if (cmp) {
              const paramLoc = cmp.paramLocations?.[paramName];
              if (paramLoc && paramLoc.line - 1 < lines.length) {
                const pLineIdx = paramLoc.line - 1;
                const lineText = lines[pLineIdx]!;
                const updatedLine = lineText.replace(/(value\s*=\s*["'])([^"']*)(["'])/i, `$1${paramVal}$3`);
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: pLineIdx, character: 0 },
                      end: { line: pLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                  renderHint = "debounced";
                }
              } else if (cmp.line && cmp.line - 1 < lines.length) {
                // Upsert new <param name="..." value="..." /> inside <paramlist> or expand self-closing component
                const startLine = cmp.line - 1;
                const openLineText = lines[startLine]!;
                const indentMatch = /^(\s*)/.exec(openLineText);
                const baseIndent = indentMatch?.[1] ?? "          ";

                if (/\/>\s*$/.test(openLineText)) {
                  const tagMatch = /^(\s*<(?:User|Component)\b)/i.exec(openLineText);
                  const tagName = tagMatch?.[1]?.toLowerCase().includes("user") ? "User" : "Component";
                  const expanded =
                    openLineText.replace(/\s*\/>\s*$/, ">") +
                    `\n${baseIndent}  <paramlist>\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />\n${baseIndent}  </paramlist>\n${baseIndent}</${tagName}>`;
                  allEdits.push({
                    range: {
                      start: { line: startLine, character: 0 },
                      end: { line: startLine, character: openLineText.length },
                    },
                    newText: expanded,
                  });
                  renderHint = "debounced";
                } else {
                  let plistLine = -1;
                  let endCmpLine = startLine;
                  while (endCmpLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endCmpLine]!)) {
                    if (plistLine < 0 && /<paramlist\b/i.test(lines[endCmpLine]!)) {
                      plistLine = endCmpLine;
                    }
                    endCmpLine++;
                  }
                  if (plistLine >= 0) {
                    const plistText = lines[plistLine]!;
                    allEdits.push({
                      range: {
                        start: { line: plistLine, character: plistText.length },
                        end: { line: plistLine, character: plistText.length },
                      },
                      newText: `\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />`,
                    });
                    renderHint = "debounced";
                  } else if (endCmpLine < lines.length) {
                    allEdits.push({
                      range: {
                        start: { line: endCmpLine, character: 0 },
                        end: { line: endCmpLine, character: 0 },
                      },
                      newText: `${baseIndent}  <paramlist>\n${baseIndent}    <param name="${paramName}" value="${paramVal}" />\n${baseIndent}  </paramlist>\n`,
                    });
                    renderHint = "debounced";
                  }
                }
              }
            } else {
              const bus = allBuses.find((b) => b.id === strippedId || b.id === action.name || b.name === action.name);
              if (bus?.line && bus.line - 1 < lines.length) {
                const bLineIdx = bus.line - 1;
                const lineText = lines[bLineIdx]!;
                let updatedLine = lineText;
                if (paramName.toLowerCase() === "name") {
                  updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${paramVal}$1`);
                } else if (paramName.toLowerCase() === "basekv" || paramName.toLowerCase() === "vbase") {
                  if (/\bv_?base\s*=\s*["'][^"']*["']/i.test(lineText)) {
                    updatedLine = lineText.replace(/\bv_?base\s*=\s*(["'])[^"']*\1/i, `vbase=$1${paramVal}$1`);
                  } else {
                    updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` vbase="${paramVal}"$1`);
                  }
                }
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: bLineIdx, character: 0 },
                      end: { line: bLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                  renderHint = "debounced";
                }
              }
            }
          } else if (action.type === "addComponent") {
            const shortDef = (action.className.split(":").pop() || "Cmp").replace(/[^a-zA-Z0-9_]/g, "_");
            const instanceId = action.name || `${shortDef}_${allComponents.length + 1}`;
            const snippet = buildComponentXmlSnippet(action.className, instanceId, action.x, action.y);
            const insertLine = findSchematicEndLine(action.section);
            allEdits.push({
              range: {
                start: { line: insertLine, character: 0 },
                end: { line: insertLine, character: 0 },
              },
              newText: `${snippet}\n`,
            });
            renderHint = "immediate";
          } else if (action.type === "deleteComponents") {
            for (const name of action.names) {
              const strippedId = stripPrefix(name);
              const cmp = allComponents.find((c) => c.id === strippedId || c.id === name || c.instanceName === name);
              if (cmp?.line && cmp.line - 1 < lines.length) {
                const startLine = cmp.line - 1;
                let endLine = startLine;
                if (!/\/>\s*$/.test(lines[startLine]!)) {
                  while (endLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endLine]!)) {
                    endLine++;
                  }
                }
                allEdits.push({
                  range: {
                    start: { line: startLine, character: 0 },
                    end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                  },
                  newText: "",
                });
                renderHint = "immediate";
                continue;
              }
              const bus = allBuses.find((b) => b.id === strippedId || b.id === name || b.name === name);
              if (bus?.line && bus.line - 1 < lines.length) {
                const startLine = bus.line - 1;
                let endLine = startLine;
                if (!/\/>\s*$/.test(lines[startLine]!)) {
                  while (endLine < lines.length && !/<\/(?:Bus|Wire)>/i.test(lines[endLine]!)) {
                    endLine++;
                  }
                }
                allEdits.push({
                  range: {
                    start: { line: startLine, character: 0 },
                    end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                  },
                  newText: "",
                });
                renderHint = "immediate";
              }
            }
          } else if (action.type === "connect") {
            let vertices: { x: number; y: number }[] = [];
            if (action.points && action.points.length >= 2) {
              vertices = action.points.map((pt) => normalizeWirePt(pt));
            } else {
              const srcPt = resolveEndpointCoords(action.source, action.sourcePort) ?? { x: 100, y: 100 };
              const dstPt = resolveEndpointCoords(action.target, action.targetPort) ?? {
                x: srcPt.x + 80,
                y: srcPt.y,
              };
              if (srcPt.x !== dstPt.x && srcPt.y !== dstPt.y) {
                vertices = [srcPt, { x: dstPt.x, y: srcPt.y }, dstPt];
              } else {
                vertices = [srcPt, dstPt];
              }
            }
            const wireId = `w_${allWires.length + 1}_${vertices[0]!.x}_${vertices[0]!.y}`;
            const vertexLines = vertices.map((v) => `            <vertex x="${v.x}" y="${v.y}" />`).join("\n");
            const wireSnippet = `          <Wire classid="WireOrthogonal" id="${wireId}">\n${vertexLines}\n          </Wire>\n`;
            const insertLine = findSchematicEndLine(action.section);
            allEdits.push({
              range: {
                start: { line: insertLine, character: 0 },
                end: { line: insertLine, character: 0 },
              },
              newText: wireSnippet,
            });
            renderHint = "immediate";
          } else if (action.type === "disconnect") {
            const matchedWire = findMatchingWire(action.source, action.target);
            if (matchedWire?.line && matchedWire.line - 1 < lines.length) {
              const startLine = matchedWire.line - 1;
              let endLine = startLine;
              if (!/\/>\s*$/.test(lines[startLine]!)) {
                while (endLine < lines.length && !/<\/Wire>/i.test(lines[endLine]!)) {
                  endLine++;
                }
              }
              allEdits.push({
                range: {
                  start: { line: startLine, character: 0 },
                  end: { line: Math.min(lines.length, endLine + 1), character: 0 },
                },
                newText: "",
              });
              renderHint = "immediate";
            }
          } else if (action.type === "moveEdge") {
            for (const edge of action.edges) {
              if (!edge.points || edge.points.length < 2) continue;
              const matchedWire = findMatchingWire(edge.source, edge.target);
              if (matchedWire) {
                rewriteWireVertices(matchedWire, edge.points);
                renderHint = "immediate";
              }
            }
          } else if (action.type === "reconnect") {
            const matchedWire =
              (action.edgeId ? findMatchingWire(action.edgeId, action.edgeId) : undefined) ??
              findMatchingWire(action.oldSource, action.oldTarget);
            if (matchedWire) {
              let newVertices: { x: number; y: number }[] = [];
              if (action.points && action.points.length >= 2) {
                newVertices = action.points.map((pt) => normalizeWirePt(pt));
              } else {
                const srcPt = resolveEndpointCoords(action.newSource, action.newSourcePort) ??
                  matchedWire.vertices[0] ?? { x: 100, y: 100 };
                const dstPt = resolveEndpointCoords(action.newTarget, action.newTargetPort) ??
                  matchedWire.vertices[matchedWire.vertices.length - 1] ?? { x: srcPt.x + 80, y: srcPt.y };
                if (srcPt.x !== dstPt.x && srcPt.y !== dstPt.y) {
                  newVertices = [srcPt, { x: dstPt.x, y: srcPt.y }, dstPt];
                } else {
                  newVertices = [srcPt, dstPt];
                }
              }
              rewriteWireVertices(matchedWire, newVertices);
              renderHint = "immediate";
            }
          } else if (action.type === "updateName") {
            const strippedOld = stripPrefix(action.oldName);
            const cmp = allComponents.find(
              (c) => c.id === strippedOld || c.id === action.oldName || c.instanceName === action.oldName,
            );
            if (cmp) {
              const nameLoc = cmp.paramLocations?.["Name"] ?? cmp.paramLocations?.["name"];
              if (nameLoc && nameLoc.line - 1 < lines.length) {
                const pLineIdx = nameLoc.line - 1;
                const lineText = lines[pLineIdx]!;
                const updatedLine = lineText.replace(/(value\s*=\s*["'])([^"']*)(["'])/i, `$1${action.newName}$3`);
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: pLineIdx, character: 0 },
                      end: { line: pLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                  renderHint = "immediate";
                }
              } else if (cmp.line && cmp.line - 1 < lines.length) {
                const cLineIdx = cmp.line - 1;
                const lineText = lines[cLineIdx]!;
                let updatedLine = lineText;
                if (/\bname\s*=\s*["'][^"']*["']/i.test(lineText)) {
                  updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${action.newName}$1`);
                } else {
                  updatedLine = lineText.replace(/(\s*\/?>)\s*$/, ` name="${action.newName}"$1`);
                }
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: cLineIdx, character: 0 },
                      end: { line: cLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                  renderHint = "immediate";
                }
              }
            } else {
              const bus = allBuses.find(
                (b) => b.id === strippedOld || b.id === action.oldName || b.name === action.oldName,
              );
              if (bus?.line && bus.line - 1 < lines.length) {
                const bLineIdx = bus.line - 1;
                const lineText = lines[bLineIdx]!;
                const updatedLine = lineText.replace(/\bname\s*=\s*(["'])[^"']*\1/i, `name=$1${action.newName}$1`);
                if (updatedLine !== lineText) {
                  allEdits.push({
                    range: {
                      start: { line: bLineIdx, character: 0 },
                      end: { line: bLineIdx, character: lineText.length },
                    },
                    newText: updatedLine,
                  });
                  renderHint = "immediate";
                }
              }
            }
          }
        }

        return {
          seq: params.seq,
          edits: deduplicateAndSort(allEdits),
          renderHint,
        };
      } catch {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }
    },

    async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
      try {
        const text = await readPscxSource(params.uri);
        if (!text) return null;
        const { parsePscx } = await import("@modelscript/pscad");
        const { buildPscadDiagram } = await import("@modelscript/diagram/pscad-diagram-builder");
        const project = parsePscx(text);

        const candidateId = params.componentId || params.nodeId || params.componentName || params.className || "";
        const strippedId = candidateId.startsWith("cmp_") ? candidateId.slice(4) : candidateId;

        const allComponents = [
          ...project.rootModule.components,
          ...Array.from(project.subModules.values()).flatMap((m) => m.components),
        ];

        let targetModuleName = params.className || "";
        if (!targetModuleName || !project.subModules.has(targetModuleName)) {
          const cmp = allComponents.find(
            (c) => c.id === strippedId || c.id === candidateId || c.instanceName === candidateId,
          );
          if (cmp) {
            const cleanDef = cmp.definitionName.split(":").pop() || cmp.definitionName;
            if (project.subModules.has(cleanDef)) {
              targetModuleName = cleanDef;
            } else if (cmp.instanceName && project.subModules.has(cmp.instanceName)) {
              targetModuleName = cmp.instanceName;
            }
          } else if (project.subModules.has(strippedId)) {
            targetModuleName = strippedId;
          }
        }

        if (!targetModuleName || !project.subModules.has(targetModuleName)) {
          return null;
        }

        const rawDiagram = buildPscadDiagram(project, targetModuleName);
        return {
          data: formatDiagramData(rawDiagram),
          breadcrumbs: [
            { id: "Main", label: project.rootModule.name || "Main", uri: params.uri },
            { id: targetModuleName, label: targetModuleName, uri: params.uri },
          ],
          targetUri: params.uri,
          targetClassName: targetModuleName,
        };
      } catch {
        return null;
      }
    },

    async getPalette(): Promise<DiagramPalette> {
      const { getPscadPaletteCategories } = await import("@modelscript/pscad");
      return {
        categories: getPscadPaletteCategories(),
      };
    },
  };
}
