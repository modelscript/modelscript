// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getHostDocumentText,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramBackendHost,
  type DiagramData,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type DiagramPalette,
  type PropertyFieldConfig,
  type PropertyTabConfig,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";

function getUnifiedIndexFromDeps(backends: DiagramBackendHost): any {
  return (
    backends.getUnifiedIndex?.() ??
    backends.generic?.deps?.getUnifiedIndex?.() ??
    backends.modelica?.deps?.getUnifiedIndex?.()
  );
}

function numField(key: string, label: string, value: number, unit?: string): PropertyFieldConfig {
  return {
    key,
    label,
    kind: "number",
    defaultValue: value,
    unit,
  };
}

function strField(key: string, label: string, value: string): PropertyFieldConfig {
  return {
    key,
    label,
    kind: "string",
    defaultValue: value,
  };
}

function buildPropertyResponse(
  className: string,
  name: string,
  description: string,
  groups: Array<{ id: string; label: string; fields: PropertyFieldConfig[] }>,
  values: Record<string, unknown>,
): ComponentPropertyData {
  const parameters: ComponentPropertyData["parameters"] = [];
  for (const g of groups) {
    for (const f of g.fields) {
      const val = values[f.key];
      parameters.push({
        name: f.key,
        localizedName: f.label,
        value: val !== undefined ? String(val) : "",
        defaultValue: f.defaultValue !== undefined ? String(f.defaultValue) : undefined,
        unit: f.unit,
        tab: "Parameters",
        group: g.label,
      });
    }
  }
  const tabs: PropertyTabConfig[] = [{ id: "parameters", label: "Parameters", groups }];
  return {
    className,
    name,
    description,
    parameters,
    values,
    schema: { title: `${className}: ${name}`, tabs },
  };
}

/**
 * First-class bidirectional LSP `DiagramBackend` for PSS/E `.raw` / `.dyr` models.
 */
export function createPsseDiagramBackend(backends: DiagramBackendHost): DiagramBackend {
  const resolveCrossLanguageComponentDrop = (...args: any[]) =>
    backends.crossLanguageDrop?.resolveCrossLanguageComponentDrop?.(...args) ?? null;

  const readPsseSource = async (targetUri: string, overrideText?: string): Promise<string | null> => {
    if (typeof overrideText === "string") return overrideText;
    const memText = getHostDocumentText(backends, targetUri);
    if (typeof memText === "string") return memText;
    try {
      const fs = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const filePath = targetUri.startsWith("file://") ? fileURLToPath(targetUri) : targetUri;
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore fs lookup failures
    }
    return null;
  };

  const computeMinimalPsseTextEdits = async (before: string, after: string): Promise<TextEdit[]> => {
    if (before === after) return [];
    const { parsePsseCstDocument } = await import("@modelscript/psse");
    const oldLines = parsePsseCstDocument(before).lines;
    const newLines = parsePsseCstDocument(after).lines;

    if (oldLines.length === newLines.length) {
      const edits: TextEdit[] = [];
      for (let i = 0; i < oldLines.length; i++) {
        const ol = oldLines[i]!;
        const nl = newLines[i]!;
        if (ol.line !== nl.line) {
          edits.push({
            range: {
              start: { line: ol.row, character: 0 },
              end: { line: ol.row, character: ol.line.length },
            },
            newText: nl.line,
          });
        }
      }
      if (edits.length > 0) return edits;
    }

    let prefix = 0;
    const minLen = Math.min(oldLines.length, newLines.length);
    while (prefix < minLen && oldLines[prefix]!.line === newLines[prefix]!.line) prefix++;

    let oldSuffix = oldLines.length;
    let newSuffix = newLines.length;
    while (
      oldSuffix > prefix &&
      newSuffix > prefix &&
      oldLines[oldSuffix - 1]!.line === newLines[newSuffix - 1]!.line
    ) {
      oldSuffix--;
      newSuffix--;
    }

    const startLine = prefix < oldLines.length ? oldLines[prefix]!.row : Math.max(0, oldLines.length - 1);
    const endIdx = Math.max(prefix, oldSuffix - 1);
    const endLine = oldLines[endIdx]?.row ?? startLine;
    const endChar = oldLines[endIdx]?.line.length ?? 0;
    const replacement = newLines
      .slice(prefix, newSuffix)
      .map((l) => l.line)
      .join("\n");

    return [
      {
        range: {
          start: { line: startLine, character: 0 },
          end: { line: endLine, character: endChar },
        },
        newText: replacement,
      },
    ];
  };

  return {
    async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
      try {
        const text = await readPsseSource(params.uri, params.documentText);
        if (!text) return null;

        const { parseRaw, solvePowerFlow, isLikelyDyrContent, parseDyr } = await import("@modelscript/psse");
        const { buildPsseDiagram } = await import("@modelscript/diagram/psse-diagram-builder");

        if (params.uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(text)) {
          const dyr = parseDyr(text);
          if (dyr.records.length > 0) {
            const buses = new Map<
              number,
              { i: number; name: string; baseKv: number; ide: 1 | 2 | 3 | 4; vm: number }
            >();
            const generators: Array<{ i: number; id: string; pg: number; qg: number; stat: 0 | 1 }> = [];
            for (const rec of dyr.records) {
              if (!buses.has(rec.ibus)) {
                buses.set(rec.ibus, {
                  i: rec.ibus,
                  name: `BUS ${rec.ibus}`,
                  baseKv: 138,
                  ide: 2,
                  vm: 1.0,
                });
              }
              generators.push({
                i: rec.ibus,
                id: `${rec.model}_${rec.id}`,
                pg: rec.con[0] ?? 0,
                qg: 0,
                stat: 1,
              });
            }
            const dyrGraph = buildPsseDiagram({
              title1: "PSS/E Dynamic Equipment Models (.dyr)",
              buses,
              branches: [],
              generators,
            });
            return {
              nodes: dyrGraph.cells.filter((c) => c.shape !== "edge") as unknown as DiagramData["nodes"],
              edges: dyrGraph.cells.filter((c) => c.shape === "edge") as unknown as DiagramData["edges"],
              coordinateSystem: null,
              diagramBackground: null,
              metadata: { title: dyrGraph.title, dyrRecordsCount: dyr.records.length },
              cells: dyrGraph.cells,
            } as DiagramData;
          }
        }

        const parsed = parseRaw(text);
        let pf: unknown;
        if (parsed.buses.size > 0) {
          try {
            pf = solvePowerFlow(parsed);
          } catch {
            // Render topology even when power flow fails to converge (e.g. islanded case)
            pf = undefined;
          }
        }
        const graph = buildPsseDiagram(
          parsed as Parameters<typeof buildPsseDiagram>[0],
          pf as Parameters<typeof buildPsseDiagram>[1],
          params.psseOptions,
        );
        const edgeVerticesMap = new Map<string, Array<{ x: number; y: number }>>();
        for (const rawLine of text.split(/\r?\n/)) {
          const m = /^@!\s*@edge\s+(\S+)\s+vertices=([^\s]+)/i.exec(rawLine.trim());
          if (m) {
            const pts = m[2]!
              .split(";")
              .map((pair) => {
                const [xs, ys] = pair.split(",");
                return { x: Number(xs), y: Number(ys) };
              })
              .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
            if (pts.length > 0) edgeVerticesMap.set(m[1]!, pts);
          }
        }
        if (edgeVerticesMap.size > 0) {
          for (const cell of graph.cells) {
            if (cell.shape === "edge") {
              const pts = edgeVerticesMap.get(cell.id);
              if (pts) {
                (cell as unknown as { vertices?: Array<{ x: number; y: number }> }).vertices = pts;
              }
            }
          }
        }
        return {
          nodes: graph.cells.filter((c) => c.shape !== "edge") as unknown as DiagramData["nodes"],
          edges: graph.cells.filter((c) => c.shape === "edge") as unknown as DiagramData["edges"],
          coordinateSystem: null,
          diagramBackground: null,
          metadata: {
            title: graph.title,
            title1: parsed.title1,
            title2: parsed.title2,
            busCount: parsed.buses.size,
            branchCount: parsed.branches.length,
            transformerCount: parsed.transformers.length,
          },
          cells: graph.cells,
        } as DiagramData;
      } catch {
        return null;
      }
    },

    async getComponentProperties(params: DiagramGetComponentPropertiesParams): Promise<ComponentPropertyData | null> {
      try {
        const text = await readPsseSource(params.uri);
        if (!text) return null;
        const { parseRaw } = await import("@modelscript/psse");
        const psseCase = parseRaw(text);
        const cellId = params.componentName;

        if (cellId.startsWith("bus_")) {
          const busId = Number.parseInt(cellId.slice(4), 10);
          const bus = psseCase.buses.get(busId);
          if (!bus) return null;
          const values = {
            i: bus.i,
            name: bus.name.trim(),
            baseKv: bus.baseKv,
            ide: bus.ide,
            vm: bus.vm,
            va: bus.va,
            area: bus.area,
            zone: bus.zone,
            owner: bus.owner,
          };
          return buildPropertyResponse(
            "PSS/E Bus",
            `Bus ${bus.i} (${bus.name.trim()})`,
            "PSS/E steady-state bus record",
            [
              {
                id: "identity",
                label: "Identification & Type",
                fields: [
                  strField("name", "Bus Name", values.name),
                  numField("baseKv", "Base kV", values.baseKv, "kV"),
                  {
                    key: "ide",
                    label: "Bus Type Code (IDE)",
                    kind: "choice",
                    defaultValue: values.ide,
                    choices: [
                      { label: "1 - PQ Load Bus", value: 1 },
                      { label: "2 - PV Generator Bus", value: 2 },
                      { label: "3 - Swing / Slack Bus", value: 3 },
                      { label: "4 - Isolated Bus", value: 4 },
                    ],
                  },
                ],
              },
              {
                id: "voltage",
                label: "Voltage & Topology",
                fields: [
                  numField("vm", "Voltage Magnitude", values.vm, "pu"),
                  numField("va", "Voltage Angle", values.va, "deg"),
                  {
                    key: "orientation",
                    label: "Busbar Orientation",
                    kind: "choice",
                    defaultValue: 0,
                    choices: [
                      { label: "Horizontal (0°)", value: 0 },
                      { label: "Vertical (90°)", value: 90 },
                    ],
                  },
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("gen_")) {
          const [, busStr, ckt] = cellId.split("_");
          const busId = Number.parseInt(busStr ?? "0", 10);
          const gen = psseCase.generators.find((g) => g.i === busId && (!ckt || g.id.trim() === ckt));
          if (!gen) return null;
          const values = {
            i: gen.i,
            id: gen.id.trim(),
            pg: gen.pg,
            qg: gen.qg,
            vs: gen.vs,
            mbase: gen.mbase,
            qt: gen.qt,
            qb: gen.qb,
            pt: gen.pt,
            pb: gen.pb,
            stat: gen.stat,
          };
          return buildPropertyResponse(
            "PSS/E Generator",
            `Gen ${gen.i}:${gen.id.trim()}`,
            "PSS/E generator machine record",
            [
              {
                id: "dispatch",
                label: "Active / Reactive Dispatch",
                fields: [
                  numField("pg", "Pgen (PG)", values.pg, "MW"),
                  numField("qg", "Qgen (QG)", values.qg, "Mvar"),
                  numField("vs", "Scheduled Voltage (VS)", values.vs, "pu"),
                  numField("mbase", "MVA Base (MBASE)", values.mbase, "MVA"),
                  numField("stat", "In-Service Status (STAT)", values.stat),
                ],
              },
              {
                id: "limits",
                label: "Capability Limits",
                fields: [
                  numField("pt", "Pmax (PT)", values.pt, "MW"),
                  numField("pb", "Pmin (PB)", values.pb, "MW"),
                  numField("qt", "Qmax (QT)", values.qt, "Mvar"),
                  numField("qb", "Qmin (QB)", values.qb, "Mvar"),
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("load_")) {
          const [, busStr, ckt] = cellId.split("_");
          const busId = Number.parseInt(busStr ?? "0", 10);
          const load = psseCase.loads.find((l) => l.i === busId && (!ckt || l.id.trim() === ckt));
          if (!load) return null;
          const values = {
            i: load.i,
            id: load.id.trim(),
            pl: load.pl,
            ql: load.ql,
            ip: load.ip,
            iq: load.iq,
            yp: load.yp,
            yq: load.yq,
            status: load.status,
          };
          return buildPropertyResponse(
            "PSS/E Load",
            `Load ${load.i}:${load.id.trim()}`,
            "PSS/E ZIP load record",
            [
              {
                id: "power",
                label: "Constant Power / Current / Admittance",
                fields: [
                  numField("pl", "Active Power (PL)", values.pl, "MW"),
                  numField("ql", "Reactive Power (QL)", values.ql, "Mvar"),
                  numField("ip", "Constant Current P (IP)", values.ip, "MW"),
                  numField("iq", "Constant Current Q (IQ)", values.iq, "Mvar"),
                  numField("yp", "Constant Admittance G (YP)", values.yp, "MW"),
                  numField("yq", "Constant Admittance B (YQ)", values.yq, "Mvar"),
                  numField("status", "In-Service Status", values.status),
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("shunt_")) {
          const [, busStr, ckt] = cellId.split("_");
          const busId = Number.parseInt(busStr ?? "0", 10);
          const shunt = psseCase.fixedShunts.find((s) => s.i === busId && (!ckt || s.id.trim() === ckt));
          if (!shunt) return null;
          const values = { i: shunt.i, id: shunt.id.trim(), gl: shunt.gl, bl: shunt.bl, status: shunt.status };
          return buildPropertyResponse(
            "PSS/E Fixed Shunt",
            `Shunt ${shunt.i}:${shunt.id.trim()}`,
            "PSS/E fixed shunt record",
            [
              {
                id: "shunt",
                label: "Shunt Admittance",
                fields: [
                  numField("gl", "Conductance (GL)", values.gl, "MW"),
                  numField("bl", "Susceptance (BL)", values.bl, "Mvar"),
                  numField("status", "In-Service Status", values.status),
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("swshunt_")) {
          const [, busStr] = cellId.split("_");
          const busId = Number.parseInt(busStr ?? "0", 10);
          const sw = psseCase.switchedShunts.find((s) => s.i === busId);
          if (!sw) return null;
          const values = {
            i: sw.i,
            binit: sw.binit,
            vswhi: sw.vswhi,
            vswlo: sw.vswlo,
            stat: sw.stat,
          };
          return buildPropertyResponse(
            "PSS/E Switched Shunt",
            `Switched Shunt ${sw.i}`,
            "PSS/E switched shunt record",
            [
              {
                id: "control",
                label: "Voltage Control & Initial Susceptance",
                fields: [
                  numField("binit", "Initial Susceptance (BINIT)", values.binit, "Mvar"),
                  numField("vswhi", "Upper Voltage Band (VSWHI)", values.vswhi, "pu"),
                  numField("vswlo", "Lower Voltage Band (VSWLO)", values.vswlo, "pu"),
                  numField("stat", "In-Service Status (STAT)", values.stat),
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("line_") || cellId.startsWith("branch_")) {
          const [, iStr, jStr, ckt] = cellId.split("_");
          const iBus = Number.parseInt(iStr ?? "0", 10);
          const jBus = Number.parseInt(jStr ?? "0", 10);
          const br = psseCase.branches.find(
            (b) => b.i === iBus && Math.abs(b.j) === jBus && (!ckt || b.ckt.trim() === ckt),
          );
          if (!br) return null;
          const values = {
            i: br.i,
            j: br.j,
            ckt: br.ckt.trim(),
            r: br.r,
            x: br.x,
            b: br.b,
            rateA: br.rateA,
            rateB: br.rateB,
            rateC: br.rateC,
            st: br.st,
          };
          return buildPropertyResponse(
            "PSS/E AC Branch",
            `Branch ${br.i}-${Math.abs(br.j)} (${br.ckt.trim()})`,
            "PSS/E non-transformer transmission branch record",
            [
              {
                id: "impedance",
                label: "Impedance & Ratings",
                fields: [
                  numField("r", "Series Resistance (R)", values.r, "pu"),
                  numField("x", "Series Reactance (X)", values.x, "pu"),
                  numField("b", "Total Line Charging (B)", values.b, "pu"),
                  numField("rateA", "Rate A (Normal)", values.rateA, "MVA"),
                  numField("rateB", "Rate B (Emergency)", values.rateB, "MVA"),
                  numField("st", "Branch Status (ST)", values.st),
                ],
              },
            ],
            values,
          );
        }

        if (cellId.startsWith("xfmr_")) {
          const [, iStr, jStr, ckt] = cellId.split("_");
          const iBus = Number.parseInt(iStr ?? "0", 10);
          const jBus = Number.parseInt(jStr ?? "0", 10);
          const xf = psseCase.transformers.find((t) => t.i === iBus && t.j === jBus && (!ckt || t.ckt.trim() === ckt));
          if (!xf) return null;
          const values = {
            i: xf.i,
            j: xf.j,
            k: xf.k,
            ckt: xf.ckt.trim(),
            name: xf.name.trim(),
            r12: xf.r12,
            x12: xf.x12,
            sbase12: xf.sbase12,
            windv1: xf.windv1,
            nomv1: xf.nomv1,
            windv2: xf.windv2,
            nomv2: xf.nomv2,
            ang1: xf.ang1,
            rata1: xf.rata1,
            stat: xf.stat,
          };
          return buildPropertyResponse(
            xf.k !== 0 ? "PSS/E 3-Winding Transformer" : "PSS/E 2-Winding Transformer",
            `XFMR ${xf.i}-${xf.j}${xf.k !== 0 ? `-${xf.k}` : ""} (${xf.ckt.trim()})`,
            "PSS/E transformer record",
            [
              {
                id: "winding",
                label: "Winding Impedance & Tap Settings",
                fields: [
                  strField("name", "Transformer Name", values.name),
                  numField("r12", "R1-2 Resistance", values.r12, "pu"),
                  numField("x12", "X1-2 Reactance", values.x12, "pu"),
                  numField("windv1", "Winding 1 Off-Nominal Tap (WINDV1)", values.windv1, "pu"),
                  numField("windv2", "Winding 2 Off-Nominal Tap (WINDV2)", values.windv2, "pu"),
                  numField("ang1", "Phase Shift Angle (ANG1)", values.ang1, "deg"),
                  numField("rata1", "Winding 1 Rate A (RATA1)", values.rata1, "MVA"),
                  numField("stat", "Transformer Status (STAT)", values.stat),
                ],
              },
            ],
            values,
          );
        }

        return null;
      } catch {
        return null;
      }
    },

    async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
      const initialText = await readPsseSource(params.uri);
      if (initialText === null) {
        return { seq: params.seq, edits: [], renderHint: "none" };
      }

      const {
        applyPsseDiagramWriteback,
        addPsseDiagramComponent,
        deletePsseDiagramComponents,
        connectPsseDiagramBuses,
        disconnectPsseDiagramBuses,
      } = await import("@modelscript/psse");
      let workingText = initialText;

      const batchedChanges = new Map<string, Record<string, unknown>>();
      const flushBatchedChanges = () => {
        for (const [cellId, changes] of batchedChanges) {
          workingText = applyPsseDiagramWriteback(workingText, cellId, changes);
        }
        batchedChanges.clear();
      };

      for (const act of params.actions) {
        if (act.type === "updateProperty" && act.key === "vertices" && Array.isArray(act.value)) {
          flushBatchedChanges();
          const ptsStr = (act.value as Array<{ x: number; y: number }>)
            .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
            .join(";");
          const edgeRegex = new RegExp(
            `^@!\\s*@edge\\s+${act.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+vertices=[^\\r\\n]*$`,
            "m",
          );
          if (ptsStr.length > 0) {
            const line = `@! @edge ${act.name} vertices=${ptsStr}`;
            if (edgeRegex.test(workingText)) {
              workingText = workingText.replace(edgeRegex, line);
            } else {
              const sep = workingText.endsWith("\n") || workingText.length === 0 ? "" : "\n";
              workingText = `${workingText}${sep}${line}\n`;
            }
          }
        } else if (act.type === "updateProperty") {
          const bag = batchedChanges.get(act.name) ?? {};
          bag[act.key] = act.value;
          batchedChanges.set(act.name, bag);
        } else if (act.type === "updateParameter") {
          const bag = batchedChanges.get(act.name) ?? {};
          bag[act.parameter] = act.value;
          batchedChanges.set(act.name, bag);
        } else if (act.type === "updateName") {
          const bag = batchedChanges.get(act.oldName) ?? {};
          bag["name"] = act.newName;
          batchedChanges.set(act.oldName, bag);
        } else if (act.type === "addComponent") {
          flushBatchedChanges();
          const unifiedIndex = getUnifiedIndexFromDeps(backends);
          const foreignRes = unifiedIndex
            ? resolveCrossLanguageComponentDrop(unifiedIndex, act.className, "modelica", workingText)
            : null;
          if (foreignRes && (foreignRes.sourceLanguage === "modelica" || foreignRes.sourceLanguage === "pscad")) {
            const sep = workingText.endsWith("\n") || workingText.length === 0 ? "" : "\n";
            workingText = `${workingText}${sep}@! @polyglot ${foreignRes.className} x=${Math.round(act.x)} y=${Math.round(act.y)}\n`;
          } else {
            workingText = addPsseDiagramComponent(workingText, act.className, act.x, act.y);
          }
        } else if (act.type === "deleteComponents") {
          flushBatchedChanges();
          workingText = deletePsseDiagramComponents(workingText, act.names);
        } else if (act.type === "connect") {
          flushBatchedChanges();
          workingText = connectPsseDiagramBuses(workingText, act.source, act.target);
        } else if (act.type === "disconnect") {
          flushBatchedChanges();
          workingText = disconnectPsseDiagramBuses(workingText, act.source, act.target);
        } else if (act.type === "reconnect") {
          flushBatchedChanges();
          workingText = disconnectPsseDiagramBuses(workingText, act.oldSource, act.oldTarget);
          workingText = connectPsseDiagramBuses(workingText, act.newSource, act.newTarget);
        } else if (act.type === "moveEdge") {
          flushBatchedChanges();
          for (const edge of act.edges) {
            const srcBus = edge.source.split(".")[0] ?? edge.source;
            const tgtBus = edge.target.split(".")[0] ?? edge.target;
            const pts = edge.points.length > 2 ? edge.points.slice(1, -1) : edge.points;
            const ptsStr = pts
              .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
              .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
              .join(";");
            const edgeKey = `${srcBus}__${tgtBus}`;
            const edgeRegex = new RegExp(
              `^@!\\s*@edge\\s+${edgeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+vertices=[^\\r\\n]*$`,
              "m",
            );
            if (ptsStr.length > 0) {
              const line = `@! @edge ${edgeKey} vertices=${ptsStr}`;
              if (edgeRegex.test(workingText)) {
                workingText = workingText.replace(edgeRegex, line);
              } else {
                const sep = workingText.endsWith("\n") || workingText.length === 0 ? "" : "\n";
                workingText = `${workingText}${sep}${line}\n`;
              }
            }
          }
        } else if (act.type === "move") {
          for (const item of act.items) {
            const name = item.name;
            let defaultW = 156;
            let defaultH = 40;
            if (name.startsWith("gen_")) {
              defaultW = 48;
              defaultH = 48;
            } else if (name.startsWith("load_")) {
              defaultW = 84;
              defaultH = 30;
            } else if (name.startsWith("shunt_") || name.startsWith("swshunt_")) {
              defaultW = 64;
              defaultH = 30;
            }
            const cx = Math.round(item.x + (item.width ?? defaultW) / 2);
            const cy = Math.round(item.y + (item.height ?? defaultH) / 2);
            const bag = batchedChanges.get(name) ?? {};
            bag["x"] = cx;
            bag["y"] = cy;
            batchedChanges.set(name, bag);
          }
        }
      }

      flushBatchedChanges();

      const edits = await computeMinimalPsseTextEdits(initialText, workingText);
      const isMoveOnly = params.actions.length > 0 && params.actions.every((a) => a.type === "move");
      return {
        seq: params.seq,
        edits,
        renderHint: edits.length > 0 && !isMoveOnly ? "immediate" : "none",
      };
    },

    getPalette(): DiagramPalette {
      return {
        categories: [
          {
            name: "Substation Buses",
            items: [
              { label: "PQ Load Bus", className: "psse:bus_pq", description: "IDE=1 PQ load substation bus" },
              { label: "PV Generator Bus", className: "psse:bus_pv", description: "IDE=2 PV voltage-controlled bus" },
              { label: "Swing / Slack Bus", className: "psse:bus_slack", description: "IDE=3 reference swing bus" },
            ],
          },
          {
            name: "Generation & Shunts",
            items: [
              { label: "Synchronous Generator", className: "psse:generator", description: "Generator dispatch unit" },
              { label: "ZIP Load", className: "psse:load", description: "Constant MVA / current / admittance load" },
              { label: "Fixed Shunt", className: "psse:fixed_shunt", description: "Static capacitor / reactor shunt" },
              {
                label: "Switched Shunt",
                className: "psse:switched_shunt",
                description: "Voltage-regulated shunt bank",
              },
            ],
          },
          {
            name: "Transmission & Transformation",
            items: [
              { label: "AC Branch", className: "psse:branch", description: "Non-transformer AC transmission line" },
              {
                label: "2-Winding Transformer",
                className: "psse:xfmr_2w",
                description: "Two-winding LTC/phase transformer",
              },
              {
                label: "3-Winding Transformer",
                className: "psse:xfmr_3w",
                description: "Three-winding power transformer",
              },
            ],
          },
        ],
      };
    },
  };
}
