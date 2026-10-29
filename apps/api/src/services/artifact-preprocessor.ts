// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

export interface PreprocessResult {
  svg?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  viewConfigAdditions?: Record<string, unknown>;
}

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), "data", "uploads");

/**
 * Server-Side SVG Pre-generation and Metadata Extraction Service (Phase 1.2).
 * Parses uploaded engineering files and produces instant vector SVG diagrams,
 * thumbnails, and domain telemetry for feed rendering without requiring client
 * compilation overhead.
 */
export async function pregenerateServerSvgThumbnail(
  filePath: string,
  viewType: string,
  originalFilename: string,
  uploadDir?: string,
): Promise<PreprocessResult> {
  const result: PreprocessResult = {};

  const resolvedDir = uploadDir ? path.resolve(uploadDir) : DEFAULT_UPLOAD_DIR;
  const safeFilename = path.basename(filePath);
  if (!safeFilename || safeFilename === "." || safeFilename === "..") {
    return result;
  }
  const safeFilePath = path.resolve(resolvedDir, safeFilename);

  if (!safeFilePath.startsWith(resolvedDir + path.sep)) {
    return result;
  }

  if (!fs.existsSync(safeFilePath)) {
    return result;
  }

  let content: string;
  try {
    content = fs.readFileSync(safeFilePath, "utf-8");
  } catch (err) {
    console.warn("[ArtifactPreprocessor] Failed to read file:", safeFilePath, err);
    return result;
  }

  const baseTitle = path.parse(originalFilename).name;

  const inlineCode = content.length <= 250_000 ? content : undefined;

  try {
    switch (viewType) {
      case "pscad": {
        const { parsePscx, extractEmtNetlist } = await import("@modelscript/pscad");
        const { renderPscadSvg } = await import("@modelscript/diagram/pscad-diagram-builder");

        const project = parsePscx(content);
        const svg = renderPscadSvg(project);
        const netlist = extractEmtNetlist(project);

        const firstDef = project.definitions ? Array.from(project.definitions.values())[0] : undefined;

        result.svg = svg;
        result.metadata = {
          projectTitle: project.name || baseTitle,
          definitionName: firstDef?.name,
          busCount: netlist.buses.size,
          componentCount:
            (netlist.branches?.length || 0) + (netlist.transformers?.length || 0) + (netlist.sources?.length || 0),
          transformerCount: netlist.transformers?.length || 0,
          branchCount: netlist.branches?.length || 0,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          netlist,
          title: project.name || baseTitle,
          projectTitle: project.name || baseTitle,
          definitionName: firstDef?.name,
        };
        break;
      }

      case "psse": {
        const { parseRaw, extractPowerFlowNetlist } = await import("@modelscript/psse");
        const { renderPsseSvg } = await import("@modelscript/diagram/psse-diagram-builder");

        const parsed = parseRaw(content);
        const svg = renderPsseSvg(parsed);
        const netlist = extractPowerFlowNetlist(parsed);

        const lossesMw = Math.max(0, netlist.metrics.totalGenMw - netlist.metrics.totalLoadMw);
        const busList = Array.from(parsed.buses.values());

        result.svg = svg;
        result.metadata = {
          busCount: parsed.buses.size,
          generatorCount: parsed.generators.length,
          branchCount: parsed.branches.length,
          transformerCount: parsed.transformers.length,
          totalGenMw: netlist.metrics.totalGenMw,
          totalLoadMw: netlist.metrics.totalLoadMw,
          lossesMw,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          metrics: {
            ...netlist.metrics,
            lossesMw,
          },
          buses: busList.slice(0, 50).map((b) => ({
            id: b.i,
            name: b.name,
            baseKv: b.baseKv,
            vm: b.vm,
            va: b.va,
          })),
          title: baseTitle,
        };
        break;
      }

      case "olga": {
        const { parseOlga } = await import("@modelscript/olga");
        const { renderOlgaSchematicSvg } = await import("@modelscript/diagram/olga-diagram-builder");

        const model = parseOlga(content);
        const svg = renderOlgaSchematicSvg(model);
        const allPipes = (model.flowpaths || []).flatMap((fp) => fp.pipes || []);
        const totalLength = allPipes.reduce((acc, p) => acc + (p.length || 0), 0);
        let minElev = Infinity;
        let maxElev = -Infinity;
        for (const p of allPipes) {
          if (typeof p.elevation === "number") {
            minElev = Math.min(minElev, p.elevation);
            maxElev = Math.max(maxElev, p.elevation);
          }
        }
        const elevDelta = Number.isFinite(maxElev - minElev) ? Math.max(0, Math.round(maxElev - minElev)) : 0;

        result.svg = svg;
        result.metadata = {
          networkTitle: model.title || baseTitle,
          flowpathCount: model.flowpaths?.length || 0,
          pipeCount: allPipes.length,
          totalLengthKm: totalLength > 0 ? +(totalLength / 1000).toFixed(1) : 0,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          networkTitle: model.title || baseTitle,
          flowpathCount: model.flowpaths?.length || 0,
          pipeCount: allPipes.length,
          totalLengthKm: totalLength > 0 ? +(totalLength / 1000).toFixed(1) : 0,
          elevationDeltaMeters: elevDelta,
          title: model.title || baseTitle,
        };
        break;
      }

      case "easy5": {
        const { parseEasy5, renderEasy5SchematicSvg } = await import("@modelscript/easy5");

        const model = parseEasy5(content);
        const svg = renderEasy5SchematicSvg(model);
        const compCount = model.components ? model.components.size : 0;
        const connCount = model.connections?.length || 0;

        let dynamicStates = 0;
        let inputCount = 0;
        let outputCount = 0;
        for (const comp of model.components?.values() ?? []) {
          const cTyped = comp as {
            type?: string | undefined;
            inputs?: Record<string, unknown> | undefined;
            outputs?: Record<string, unknown> | undefined;
          };
          const t = comp.type?.toUpperCase() || "";
          if (t === "IN" || t === "INTEGRATOR" || t === "LAG" || t === "POLE") dynamicStates += 1;
          else if (t === "TF" || t === "SECOND_ORDER") dynamicStates += 2;
          if (cTyped.inputs) inputCount += Object.keys(cTyped.inputs).length;
          if (cTyped.outputs) outputCount += Object.keys(cTyped.outputs).length;
        }

        result.svg = svg;
        result.metadata = {
          modelName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          modelName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
          stateCount: dynamicStates,
          inputCount,
          outputCount,
          title: model.title || baseTitle,
        };
        break;
      }

      case "rocets": {
        const { parseRocetsDeck, renderRocetsPidSvg } = await import("@modelscript/rocets");

        const model = parseRocetsDeck(content);
        const svg = renderRocetsPidSvg(model);
        const compCount = model.components ? model.components.size : 0;
        const connCount = model.connections?.length || 0;

        let chamberP: number | undefined;
        let totalMdot = 0;
        let mainMr: number | undefined;
        for (const comp of model.components?.values() ?? []) {
          if (comp.type === "CHAMBER") {
            if (comp.parameters?.["PC"]) {
              const rawPc = Number(comp.parameters["PC"]);
              chamberP = rawPc > 1000 ? +(rawPc / 1e6).toFixed(2) : +rawPc.toFixed(2);
            }
            if (comp.parameters?.["MR"]) mainMr = Number(comp.parameters["MR"]);
          }
          if (comp.parameters?.["MDOT"]) totalMdot += Number(comp.parameters["MDOT"]);
        }

        result.svg = svg;
        result.metadata = {
          engineName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          engineName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
          ...(chamberP !== undefined ? { chamberPressureMpa: chamberP } : {}),
          ...(totalMdot > 0 ? { massFlowKgSec: +totalMdot.toFixed(2) } : {}),
          ...(mainMr !== undefined ? { mixtureRatio: mainMr } : {}),
          title: model.title || baseTitle,
        };
        break;
      }

      case "lps": {
        const { parseLps } = await import("@modelscript/lps");
        const { renderLpsSchematicSvg } = await import("@modelscript/diagram/lps-diagram-builder");

        const model = parseLps(content);
        const svg = renderLpsSchematicSvg(model);

        let minP = Infinity;
        let maxP = -Infinity;
        for (const node of model.nodes) {
          if (typeof node.pressure === "number") {
            minP = Math.min(minP, node.pressure);
            maxP = Math.max(maxP, node.pressure);
          }
        }
        const minPBar = Number.isFinite(minP) ? +(minP > 1000 ? minP / 1e5 : minP).toFixed(1) : undefined;
        const maxPBar = Number.isFinite(maxP) ? +(maxP > 1000 ? maxP / 1e5 : maxP).toFixed(1) : undefined;

        result.svg = svg;
        result.metadata = {
          networkName: model.title || baseTitle,
          pipeCount: model.pipes.length,
          nodeCount: model.nodes.length,
          compressorCount: model.compressors.length,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          networkName: model.title || baseTitle,
          totalPipes: model.pipes.length,
          totalNodes: model.nodes.length,
          totalCompressors: model.compressors.length,
          ...(minPBar !== undefined ? { minPressureBar: minPBar } : {}),
          ...(maxPBar !== undefined ? { maxPressureBar: maxPBar } : {}),
          title: model.title || baseTitle,
        };
        break;
      }

      case "gtsuite": {
        const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("@modelscript/gtsuite");

        const model = parseGtmModel(content);
        const svg = renderGtSuiteSchematicSvg(model);
        const cylinders = (model.components || []).filter((c) => c.kind === "cylinder") as {
          displacementM3?: number | undefined;
          boreM?: number | undefined;
          strokeM?: number | undefined;
        }[];
        const cylCount = cylinders.length;
        let totalDisplacementL = 0;
        for (const c of cylinders) {
          if (typeof c.displacementM3 === "number") {
            totalDisplacementL += c.displacementM3 * 1000.0;
          } else if (typeof c.boreM === "number" && typeof c.strokeM === "number") {
            const boreMm = c.boreM * 1000.0;
            const strokeMm = c.strokeM * 1000.0;
            totalDisplacementL += (Math.PI * Math.pow(boreMm / 20.0, 2) * (strokeMm / 10.0)) / 1000.0;
          }
        }
        const dispLiters = totalDisplacementL > 0 ? +totalDisplacementL.toFixed(2) : undefined;

        result.svg = svg;
        result.metadata = {
          engineModel: model.title || model.name || baseTitle,
          componentCount: model.components?.length || 0,
          cylinderCount: cylCount,
          ...(dispLiters !== undefined ? { displacementLiters: dispLiters } : {}),
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          engineModel: model.title || model.name || baseTitle,
          componentCount: model.components?.length || 0,
          cylinderCount: cylCount,
          ...(dispLiters !== undefined ? { displacementLiters: dispLiters } : {}),
          title: model.title || model.name || baseTitle,
        };
        break;
      }

      case "sima": {
        const { parseSimaFile } = await import("@modelscript/sima");
        const { renderSimaMooringSpreadSvg } = await import("@modelscript/diagram/sima-diagram-builder");

        const model = parseSimaFile(content);
        const linesCount = model.lines?.length || 0;
        const waterDepth = model.environment?.waterDepth;
        const svg = renderSimaMooringSpreadSvg({
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring Spread` : `${baseTitle} Mooring Spread`,
          waterDepth: waterDepth || 100,
          vesselName: model.vessels[0]?.name ?? baseTitle,
          watchCircleRadius: 15,
          vesselOffset: { x: 0, y: 0 },
          lines: (model.lines || []).map(
            (
              l: {
                id?: string | undefined;
                length?: number | undefined;
                totalLength?: number | undefined;
                name?: string | undefined;
                pretension?: number | undefined;
                mbl?: number | undefined;
                anchorPosition?: [number, number, number] | undefined;
                fairleadPosition?: [number, number, number] | undefined;
                anchorX?: number | undefined;
                anchorY?: number | undefined;
                anchorZ?: number | undefined;
                fairleadX?: number | undefined;
                fairleadY?: number | undefined;
                fairleadZ?: number | undefined;
              },
              i: number,
            ) => {
              const hasExplicitAnchor =
                l.anchorX !== undefined ||
                l.anchorY !== undefined ||
                l.anchorZ !== undefined ||
                l.anchorPosition !== undefined;
              const fallbackRad = (2 * Math.PI * i) / Math.max(1, linesCount);
              const fallbackR = l.totalLength || l.length || (waterDepth ? waterDepth * 2 : 500);
              const ancX = hasExplicitAnchor
                ? (l.anchorX ?? l.anchorPosition?.[0] ?? 0)
                : Math.round(fallbackR * Math.cos(fallbackRad));
              const ancY = hasExplicitAnchor
                ? (l.anchorY ?? l.anchorPosition?.[1] ?? 0)
                : Math.round(fallbackR * Math.sin(fallbackRad));
              const ancZ = l.anchorZ ?? l.anchorPosition?.[2] ?? -(waterDepth || 100);
              const flX = l.fairleadX ?? l.fairleadPosition?.[0];
              const flY = l.fairleadY ?? l.fairleadPosition?.[1];
              const flZ = l.fairleadZ ?? l.fairleadPosition?.[2];
              const anchorR = Math.hypot(ancX, ancY) || fallbackR;
              const azimuthDeg = ((Math.atan2(ancY, ancX) * 180) / Math.PI + 360) % 360;
              return {
                id: l.id || `line-${i + 1}`,
                name: l.name || `Line #${i + 1}`,
                anchorRadius: anchorR,
                azimuthDeg,
                tension: l.pretension || 0,
                mbl: l.mbl || 0,
                ...(flX !== undefined || flY !== undefined || flZ !== undefined
                  ? { fairleadPos: [flX ?? 0, flY ?? 0, flZ ?? 0] as [number, number, number] }
                  : {}),
                anchorPos: [ancX, ancY, ancZ] as [number, number, number],
              };
            },
          ),
        });

        result.svg = svg;
        result.metadata = {
          ...(waterDepth !== undefined ? { waterDepth } : {}),
          lineCount: linesCount,
          vesselName: model.vessels[0]?.name,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          ...(waterDepth !== undefined ? { waterDepthMeters: waterDepth } : {}),
          mooringLinesCount: linesCount,
          vesselName: model.vessels[0]?.name,
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring System` : baseTitle,
        };
        break;
      }

      case "gensys": {
        const { parseGensysDeck, renderGensysSvg } = await import("@modelscript/gensys");
        const model = parseGensysDeck(content, baseTitle);
        const svg = renderGensysSvg(model);
        const bodies = Array.from(model.bodies.values()).map((b) => {
          const rawB = b as unknown as {
            name: string;
            mass: number;
            ixx?: number | undefined;
            iyy?: number | undefined;
            izz?: number | undefined;
            inertia?: number[] | undefined;
            x?: number | undefined;
            y?: number | undefined;
            z?: number | undefined;
            cg?: number[] | undefined;
          };
          return {
            name: rawB.name,
            mass: rawB.mass,
            inertia: [
              rawB.ixx ?? rawB.inertia?.[0] ?? 0,
              rawB.iyy ?? rawB.inertia?.[1] ?? 0,
              rawB.izz ?? rawB.inertia?.[2] ?? 0,
            ],
            cg: [rawB.x ?? rawB.cg?.[0] ?? 0, rawB.y ?? rawB.cg?.[1] ?? 0, rawB.z ?? rawB.cg?.[2] ?? 0],
          };
        });
        const couplings = Array.from(model.couplings.values()).map((c) => {
          const rawC = c as unknown as {
            name: string;
            type: string;
            bodyFrom?: string | undefined;
            from?: string | undefined;
            bodyTo?: string | undefined;
            to?: string | undefined;
            stiffnessOrDamping?: number | undefined;
            stiffness?: number | undefined;
          };
          return {
            name: rawC.name,
            type: rawC.type,
            from: rawC.bodyFrom ?? rawC.from ?? "",
            to: rawC.bodyTo ?? rawC.to ?? "",
            stiffness: rawC.stiffnessOrDamping ?? rawC.stiffness ?? 0,
          };
        });
        result.svg = svg;
        result.metadata = {
          bodyCount: bodies.length,
          couplingCount: couplings.length,
          wheelsetCount: model.wheelsets.size,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: model.name || baseTitle,
          bodies,
          couplings,
          wheelsetCount: model.wheelsets.size,
        };
        break;
      }

      case "simpack": {
        const { parseSimDeck, parseSpckXml, renderSimpackSvg } = await import("@modelscript/simpack");
        const isXml = content.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(content, baseTitle) : parseSimDeck(content, baseTitle);
        const svg = renderSimpackSvg(model);
        const bodies = Array.from(model.bodies.values()).map((b: { name: string; mass: number }) => ({
          name: b.name,
          mass: b.mass,
        }));
        const joints = Array.from(model.joints.values()).map(
          (j: {
            name: string;
            type: string;
            bodyFrom?: string | undefined;
            from?: string | undefined;
            bodyTo?: string | undefined;
            to?: string | undefined;
          }) => ({
            name: j.name,
            type: j.type,
            from: j.bodyFrom ?? j.from ?? "",
            to: j.bodyTo ?? j.to ?? "",
          }),
        );
        const forces = Array.from(model.forces.values()).map(
          (f: {
            name: string;
            type: string;
            bodyFrom?: string | undefined;
            from?: string | undefined;
            bodyTo?: string | undefined;
            to?: string | undefined;
            parameters?: Record<string, unknown> | undefined;
          }) => ({
            name: f.name,
            type: f.type,
            from: f.bodyFrom ?? f.from ?? "",
            to: f.bodyTo ?? f.to ?? "",
            parameters: f.parameters ?? {},
          }),
        );
        result.svg = svg;
        result.metadata = {
          bodyCount: bodies.length,
          jointCount: joints.length,
          forceCount: forces.length,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: model.name || baseTitle,
          bodies,
          joints,
          forces,
        };
        break;
      }

      case "adams": {
        const { parseAdams, renderAdamsSvg } = await import("@modelscript/adams");
        const model = parseAdams(content);
        result.svg = renderAdamsSvg(model);
        result.metadata = {
          partCount: model.parts.size,
          jointCount: model.joints.size,
          forceCount: model.forces.size,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: model.title || baseTitle,
          partCount: model.parts.size,
          jointCount: model.joints.size,
          forceCount: model.forces.size,
        };
        break;
      }

      case "urdf": {
        const { parseUrdf, renderUrdfSvg } = await import("@modelscript/urdf");
        const robot = parseUrdf(content);
        result.svg = renderUrdfSvg(robot);
        result.metadata = {
          linkCount: robot.links.size,
          jointCount: robot.joints.size,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: robot.name || baseTitle,
          linkCount: robot.links.size,
          jointCount: robot.joints.size,
        };
        break;
      }

      case "opendrive": {
        const { parseOpenDrive, renderOpenDriveSvg } = await import("@modelscript/opendrive");
        const map = parseOpenDrive(content);
        result.svg = renderOpenDriveSvg(map);
        result.metadata = {
          roadCount: map.roads.length,
          junctionCount: map.junctions.length,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: map.header?.name || baseTitle,
          roadCount: map.roads.length,
          junctionCount: map.junctions.length,
        };
        break;
      }

      case "spice": {
        const { parseSpice } = await import("@modelscript/spice");
        const { renderSpiceSvg } = await import("@modelscript/diagram/spice-diagram-builder");
        const deck = parseSpice(content) as unknown as {
          title?: string | undefined;
          elements?: unknown[] | { size?: number | undefined } | undefined;
          components?: unknown[] | { size?: number | undefined } | undefined;
          subcircuits?: unknown[] | Map<string, unknown> | undefined;
          models?: { size?: number | undefined } | undefined;
        };
        const elements = deck.elements || deck.components || [];
        const componentsArr = Array.isArray(elements) ? elements : [];
        const subcircuits = deck.subcircuits
          ? Array.isArray(deck.subcircuits)
            ? deck.subcircuits
            : Array.from(deck.subcircuits.values())
          : [];
        result.svg = renderSpiceSvg({
          title: deck.title || baseTitle,
          components: componentsArr,
          elements: componentsArr,
          subcircuits,
        } as unknown as Parameters<typeof renderSpiceSvg>[0]);
        const elemCount = Array.isArray(elements) ? elements.length : elements.size || 0;
        const subcktCount = Array.isArray(subcircuits) ? subcircuits.length : 0;
        const modelCount = deck.models ? (typeof deck.models.size === "number" ? deck.models.size : 0) : 0;
        result.metadata = {
          elementCount: elemCount,
          subcircuitCount: subcktCount,
          modelCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: deck.title || baseTitle,
          elementCount: elemCount,
          subcircuitCount: subcktCount,
        };
        break;
      }

      case "simulink": {
        interface SimulinkRootSys {
          blocks?: { size?: number | undefined; length?: number | undefined } | undefined;
          lines?: { size?: number | undefined; length?: number | undefined } | undefined;
        }
        interface SimulinkParsedModel extends SimulinkRootSys {
          name?: string | undefined;
          rootSystem?: SimulinkRootSys | undefined;
        }
        const simulinkMod = (await import("@modelscript/simulink")) as unknown as {
          parseSimulinkXml?: ((src: string, name: string) => SimulinkParsedModel) | undefined;
          parseSlxXml?: ((src: string, name: string) => SimulinkParsedModel) | undefined;
          parseMdl: (src: string, name: string) => SimulinkParsedModel;
        };
        const { renderSimulinkSvg } = await import("@modelscript/diagram/simulink-diagram-builder");
        const isXml = content.trimStart().startsWith("<");
        const parseXmlFn = simulinkMod.parseSimulinkXml || simulinkMod.parseSlxXml || simulinkMod.parseMdl;
        const model = isXml ? parseXmlFn(content, baseTitle) : simulinkMod.parseMdl(content, baseTitle);
        const rootSys = model.rootSystem || model;
        result.svg = renderSimulinkSvg(rootSys as unknown as Parameters<typeof renderSimulinkSvg>[0]);
        const blockCount = rootSys.blocks?.size ?? rootSys.blocks?.length ?? 0;
        const lineCount = rootSys.lines?.length ?? rootSys.lines?.size ?? 0;
        result.metadata = {
          blockCount,
          lineCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: model.name || baseTitle,
          blockCount,
          lineCount,
        };
        break;
      }

      case "fea-deck": {
        const { parseInpDeck } = await import("@modelscript/fea");
        const deck = parseInpDeck(content) as unknown as FeaDeckLike;
        const svg = buildFeaMeshSvgFromDeck(deck, baseTitle);
        const stepCount = deck.steps?.length ?? deck.steps?.size ?? 0;
        const boundaryCount = deck.boundaries?.length ?? deck.boundaries?.size ?? 0;
        const cloadCount = deck.cloads?.length ?? deck.cloads?.size ?? 0;
        const dloadCount = deck.dloads?.length ?? deck.dloads?.size ?? 0;
        result.svg = svg;
        result.metadata = {
          nodeCount: deck.nodes?.size ?? 0,
          elementCount: deck.elements?.size ?? 0,
          materialCount: deck.materials?.size ?? 0,
          stepCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: deck.heading || baseTitle,
          nodes: deck.nodes?.size ?? 0,
          elements: deck.elements?.size ?? 0,
          materials: deck.materials ? Array.from(deck.materials.keys()) : [],
          stepCount,
          boundaryCount,
          loadCount: cloadCount + dloadCount,
        };
        break;
      }

      case "cfd-config": {
        const { parseSu2Config } = await import("@modelscript/cfd");
        const cfg = parseSu2Config(content) as unknown as Su2ConfigLike;
        result.metadata = {
          solver: cfg.solver,
          machNumber: cfg.machNumber,
          aoa: cfg.aoa,
          reynoldsNumber: cfg.reynoldsNumber,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          solver: cfg.solver,
          turbulenceModel: cfg.kindTurbModel,
          mathProblem: cfg.mathProblem,
          machNumber: cfg.machNumber,
          aoa: cfg.aoa,
          reynoldsNumber: cfg.reynoldsNumber,
          markersEuler: cfg.markersEuler,
          markersFar: cfg.markersFar,
          markersHeatflux: cfg.markersHeatflux,
        };
        break;
      }

      case "owl2": {
        interface Owl2NodeLike {
          kind?: string | undefined;
          type?: string | undefined;
        }
        interface Owl2DiagramLike {
          nodes?: Owl2NodeLike[] | undefined;
          edges?: unknown[] | undefined;
        }
        const owlMod = (await import("@modelscript/owl2")) as unknown as {
          parseOWL2?: ((src: string) => { axioms?: unknown[] | undefined; iri?: string | undefined }) | undefined;
          buildOWL2DiagramData?: ((axioms: unknown[]) => Owl2DiagramLike) | undefined;
        };
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const ontology = owlMod.parseOWL2 ? owlMod.parseOWL2(content) : { axioms: [], iri: baseTitle };
        const diag: Owl2DiagramLike = owlMod.buildOWL2DiagramData
          ? owlMod.buildOWL2DiagramData(ontology.axioms || [])
          : buildPolyglotDiagramFromSource(content, "owl2", baseTitle);
        result.svg = renderPolyglotDiagramToSvg(diag as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0], {
          theme: "dark",
        });
        const classCount = (diag.nodes || []).filter((n) => n.kind === "class" || n.type === "class").length;
        const indivCount = (diag.nodes || []).filter((n) => n.kind === "individual" || n.type === "individual").length;
        result.metadata = {
          classCount,
          axiomCount: ontology.axioms?.length || diag.nodes?.length || 0,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: ontology.iri || baseTitle,
          classes: classCount,
          axioms: ontology.axioms?.length || diag.nodes?.length || 0,
          individuals: indivCount,
        };
        break;
      }

      case "modelica-diagram":
      case "modelica-code":
      case "modelica":
      case "morsel":
      case "polyglot-morsel": {
        const { preprocessModelicaArtifact } = await import("./modelica-artifact-renderer.js");
        const moRes = await preprocessModelicaArtifact(content, baseTitle);
        result.svg = moRes.svg;
        result.metadata = moRes.metadata;
        result.viewConfigAdditions = {
          ...moRes.viewConfigAdditions,
          code: inlineCode,
          title: moRes.title || baseTitle,
        };
        break;
      }

      case "fortran":
      case "c":
      case "plcopen":
      case "verilog-a":
      case "scad":
      case "csg":
      case "ccsds":
      case "energyplus":
      case "reqif":
      case "autosar": {
        result.metadata = {
          dialect: viewType,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          dialect: viewType,
        };
        break;
      }

      case "sysml":
      case "sysml2":
      case "modelscript":
      case "ssp": {
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const dslLang = viewType === "sysml" ? "sysml2" : viewType;
        const diag = buildPolyglotDiagramFromSource(content, dslLang, baseTitle);
        if (diag.nodes.length > 0) {
          result.svg = renderPolyglotDiagramToSvg(diag as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0], {
            theme: "dark",
          });
        }
        result.metadata = {
          nodeCount: diag.nodes.length,
          connectionCount: diag.edges.length,
          dialect: dslLang,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          dialect: dslLang,
          nodeCount: diag.nodes.length,
          connectionCount: diag.edges.length,
        };
        break;
      }

      case "epanet": {
        const { parseEpanet } = await import("@modelscript/epanet");
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const net = parseEpanet(content);
        const rawNodes: { id: string; type: string }[] = [
          ...net.reservoirs.map((r) => ({ id: r.id, type: `Reservoir (${r.totalHead} m)` })),
          ...net.tanks.map((t) => ({ id: t.id, type: `Tank (D=${t.diameter} m)` })),
          ...net.junctions.map((j) => ({ id: j.id, type: `Junction (z=${j.elevation} m)` })),
        ];
        const cols = 4;
        const nodes = rawNodes.map((n, idx) => {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const x = 60 + col * 210;
          const y = 60 + row * 120;
          return {
            id: n.id,
            type: n.type,
            kind: "component",
            x,
            y,
            width: 155,
            height: 68,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
            ports: [
              { id: `${n.id}.in`, name: "in", x: x, y: y + 34, direction: "in", domain: "fluid" },
              { id: `${n.id}.out`, name: "out", x: x + 155, y: y + 34, direction: "out", domain: "fluid" },
            ],
            iconSvg: null,
            iconShapes: [],
            iconCoordSystem: null,
          };
        });
        const nodeSet = new Set(nodes.map((n) => n.id));
        const allLinks = [
          ...net.pipes.map((p) => ({ id: p.id, node1: p.node1, node2: p.node2 })),
          ...net.pumps.map((p) => ({ id: p.id, node1: p.node1, node2: p.node2 })),
          ...net.valves.map((v) => ({ id: v.id, node1: v.node1, node2: v.node2 })),
        ];
        const edges = allLinks
          .filter((l) => nodeSet.has(l.node1) && nodeSet.has(l.node2))
          .map((l, idx) => {
            const srcNode = nodes.find((n) => n.id === l.node1)!;
            const dstNode = nodes.find((n) => n.id === l.node2)!;
            return {
              id: `link_${idx}_${l.id}`,
              sourcePort: `${l.node1}.out`,
              targetPort: `${l.node2}.in`,
              points: [
                { x: srcNode.x + 155, y: srcNode.y + 34 },
                { x: dstNode.x, y: dstNode.y + 34 },
              ],
              color: [56, 189, 248] as [number, number, number],
              thickness: 1.8,
              pattern: "Solid",
            };
          });
        if (nodes.length > 0) {
          result.svg = renderPolyglotDiagramToSvg(
            {
              nodes,
              edges,
              coordinateSystem: null,
              diagramBackground: null,
            } as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0],
            { theme: "dark" },
          );
        }
        result.metadata = {
          nodeCount: nodes.length,
          connectionCount: edges.length,
          junctionCount: net.junctions.length,
          pipeCount: net.pipes.length,
          dialect: "epanet",
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: net.title || baseTitle,
          dialect: "epanet",
          nodeCount: nodes.length,
          connectionCount: edges.length,
          junctionCount: net.junctions.length,
          reservoirCount: net.reservoirs.length,
          tankCount: net.tanks.length,
          pipeCount: net.pipes.length,
          pumpCount: net.pumps.length,
          valveCount: net.valves.length,
        };
        break;
      }

      case "aspen": {
        const { parseAspen } = await import("@modelscript/aspen");
        const { renderAspenSvg } = await import("@modelscript/diagram/aspen-diagram-builder");
        const doc = parseAspen(content);
        result.svg = renderAspenSvg(doc);
        result.metadata = { blockCount: doc.blocks.size, streamCount: doc.streams.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: doc.title || baseTitle,
          blockCount: doc.blocks.size,
          streamCount: doc.streams.size,
        };
        break;
      }

      case "swmm": {
        const { parseSwmm } = await import("@modelscript/swmm");
        const { renderSwmmSvg } = await import("@modelscript/diagram/swmm-diagram-builder");
        const model = parseSwmm(content);
        result.svg = renderSwmmSvg(model as unknown as Parameters<typeof renderSwmmSvg>[0]);
        result.metadata = { junctionCount: model.junctions.size, conduitCount: model.conduits.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: model.title || baseTitle,
          junctionCount: model.junctions.size,
          conduitCount: model.conduits.size,
        };
        break;
      }

      case "touchstone": {
        const { parseTouchstone, verifyPassivity } = await import("@modelscript/touchstone");
        const { renderTouchstoneSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
        const net = parseTouchstone(content) as unknown as Parameters<typeof verifyPassivity>[0] & {
          numPorts: number;
          options: { referenceResistance: number };
          frequencies?: unknown[] | undefined;
          dataPoints?: unknown[] | undefined;
        };
        const passivity = verifyPassivity(net);
        result.svg = renderTouchstoneSvg({
          portCount: net.numPorts,
          referenceImpedance: net.options.referenceResistance,
          isPassive: passivity.isPassive,
        });
        result.metadata = { portCount: net.numPorts, isPassive: passivity.isPassive };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          portCount: net.numPorts,
          isPassive: passivity.isPassive,
          frequencyCount: net.frequencies?.length || net.dataPoints?.length || 0,
        };
        break;
      }

      case "ibis": {
        const { parseIbis } = await import("@modelscript/ibis");
        const { renderIbisBufferSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
        const model = parseIbis(content);
        const comps = Array.from(model.components.values());
        const firstComp = comps[0];
        result.svg = renderIbisBufferSvg({
          componentName: firstComp?.name || baseTitle,
          pins: firstComp
            ? Array.from(firstComp.pins.values()).map((p) => {
                const rawP = p as unknown as { pin: string; signal: string; model: string };
                return {
                  pin: rawP.pin,
                  signal: rawP.signal,
                  model: rawP.model,
                };
              })
            : [],
        });
        result.metadata = { componentCount: model.components.size, modelCount: model.models.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: firstComp?.name || baseTitle,
          componentCount: model.components.size,
          modelCount: model.models.size,
        };
        break;
      }

      case "opendss": {
        const { parseOpenDss } = await import("@modelscript/opendss");
        const { renderOpenDssSvg } = await import("@modelscript/diagram/opendss-diagram-builder");
        const deck = parseOpenDss(content);
        result.svg = renderOpenDssSvg(deck as unknown as Parameters<typeof renderOpenDssSvg>[0]);
        result.metadata = {
          lineCount: deck.lines.size,
          loadCount: deck.loads.size,
          transformerCount: deck.transformers.size,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: deck.circuit ? `Circuit.${deck.circuit.name}` : baseTitle,
          lineCount: deck.lines.size,
          loadCount: deck.loads.size,
          transformerCount: deck.transformers.size,
        };
        break;
      }

      case "openscenario": {
        const { parseOpenScenario } = await import("@modelscript/openscenario");
        const { renderOpenScenarioSvg } = await import("@modelscript/diagram/openscenario-diagram-builder");
        const scen = parseOpenScenario(content);
        result.svg = renderOpenScenarioSvg({
          title: scen.header.description || baseTitle,
          entities: Array.from(scen.entities.values()).map((e) => {
            const rawE = e as unknown as { name: string; category: string };
            return {
              name: rawE.name,
              category: rawE.category,
            };
          }) as unknown as Parameters<typeof renderOpenScenarioSvg>[0]["entities"],
        });
        result.metadata = { entityCount: scen.entities.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: scen.header.description || baseTitle,
          entityCount: scen.entities.size,
        };
        break;
      }

      case "relap5": {
        const { parseRelap5 } = await import("@modelscript/relap5");
        const { renderRelap5Svg } = await import("@modelscript/diagram/relap5-diagram-builder");
        const deck = parseRelap5(content);
        result.svg = renderRelap5Svg(deck as unknown as Parameters<typeof renderRelap5Svg>[0]);
        result.metadata = { volumeCount: deck.volumes.size, junctionCount: deck.junctions.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: deck.title || baseTitle,
          volumeCount: deck.volumes.size,
          junctionCount: deck.junctions.size,
        };
        break;
      }

      case "eclipse": {
        const { parseEclipse } = await import("@modelscript/eclipse");
        const { renderEclipseSvg } = await import("@modelscript/diagram/eclipse-diagram-builder");
        const deck = parseEclipse(content);
        result.svg = renderEclipseSvg(deck as unknown as Parameters<typeof renderEclipseSvg>[0]);
        result.metadata = { wellCount: deck.wells.size, nz: deck.dimensions?.nz };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: deck.title || baseTitle,
          wellCount: deck.wells.size,
          ...(deck.dimensions?.nz !== undefined ? { nz: deck.dimensions.nz } : {}),
        };
        break;
      }

      case "sbml": {
        const { parseSbml } = await import("@modelscript/sbml");
        const { renderSbmlSvg } = await import("@modelscript/diagram/sbml-diagram-builder");
        const doc = parseSbml(content);
        result.svg = renderSbmlSvg(doc.model);
        result.metadata = { speciesCount: doc.model.species.size, reactionCount: doc.model.reactions.size };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: doc.model.name || doc.model.id || baseTitle,
          speciesCount: doc.model.species.size,
          reactionCount: doc.model.reactions.size,
        };
        break;
      }

      case "jsbsim": {
        const { parseJsbsim } = await import("@modelscript/jsbsim");
        const { renderJsbsimSvg } = await import("@modelscript/diagram/jsbsim-diagram-builder");
        const doc = parseJsbsim(content);
        result.svg = renderJsbsimSvg({
          name: doc.model.name,
          metrics: {
            wingspan: doc.model.metrics?.wingspan,
            chord: doc.model.metrics?.chord,
            wingarea: doc.model.metrics?.wingArea,
            aerorp: doc.model.metrics?.aeroCenter,
          },
          massBalance: {
            emptywt: doc.model.massBalance?.emptyWeight,
            cg: doc.model.massBalance?.cgLocation,
          },
        });
        result.metadata = { wingspan: doc.model.metrics?.wingspan, emptyWeight: doc.model.massBalance?.emptyWeight };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: doc.model.name || baseTitle,
          wingspan: doc.model.metrics?.wingspan,
          emptyWeight: doc.model.massBalance?.emptyWeight,
        };
        break;
      }

      case "cad":
      case "cad-step":
      case "step":
      case "stp": {
        const stepSvg = renderStepIsometricSvg(content, baseTitle);
        result.svg = stepSvg.svg;
        result.metadata = {
          faceCount: stepSvg.faceCount,
          edgeCount: stepSvg.edgeCount,
          vertexCount: stepSvg.vertexCount,
        };
        result.viewConfigAdditions = {
          ...(inlineCode ? { code: inlineCode, stepSource: inlineCode } : {}),
          title: stepSvg.title || baseTitle,
          faceCount: stepSvg.faceCount,
          edgeCount: stepSvg.edgeCount,
          vertexCount: stepSvg.vertexCount,
        };
        break;
      }

      case "simulation-result":
      case "fea-result":
      case "cfd-result": {
        const vtuSvg = renderVtuIsometricSvg(content, baseTitle);
        result.svg = vtuSvg.svg;
        result.metadata = {
          pointCount: vtuSvg.pointCount,
          cellCount: vtuSvg.cellCount,
          fieldName: vtuSvg.fieldName,
          minValue: vtuSvg.minValue,
          maxValue: vtuSvg.maxValue,
        };
        result.viewConfigAdditions = {
          title: baseTitle,
          pointCount: vtuSvg.pointCount,
          cellCount: vtuSvg.cellCount,
          fieldName: vtuSvg.fieldName,
        };
        break;
      }

      case "csv": {
        const csvLines = content
          .trim()
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
        const headers = (csvLines[0] ?? "")
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean);
        const rows = csvLines.slice(1).map((line) => line.split(",").map((c) => Number(c.trim())));
        const svg = buildCsvTelemetrySvg(headers, rows, baseTitle);
        result.svg = svg;
        result.metadata = {
          rowCount: rows.length,
          columnCount: headers.length,
          columns: headers,
        };
        result.viewConfigAdditions = {
          ...(inlineCode ? { data: inlineCode, code: inlineCode } : {}),
          title: baseTitle,
          rowCount: rows.length,
          columnCount: headers.length,
          columns: headers,
        };
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.warn("[ArtifactPreprocessor] Pre-processing failed:", viewType, originalFilename, err);
  }

  // If vector SVG was generated and an upload directory is available, save the thumbnail
  if (result.svg && uploadDir) {
    try {
      const resolvedUploadDir = path.resolve(uploadDir);
      if (!fs.existsSync(resolvedUploadDir)) {
        fs.mkdirSync(resolvedUploadDir, { recursive: true });
      }
      const thumbFilename = `${path.basename(safeFilePath)}.thumb.svg`;
      const thumbPath = path.resolve(resolvedUploadDir, path.basename(thumbFilename));
      if (thumbPath.startsWith(resolvedUploadDir + path.sep) || thumbPath === resolvedUploadDir) {
        fs.writeFileSync(thumbPath, result.svg, "utf-8");
        result.thumbnailUrl = `/api/v1/storage/uploads/${thumbFilename}`;
      }
    } catch (saveErr) {
      console.warn("[ArtifactPreprocessor] Failed to save SVG thumbnail:", originalFilename, saveErr);
    }
  }

  return result;
}

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPolyglotDiagramFromSource(content: string, dslLang: string, fallbackTitle: string) {
  const nodes: {
    id: string;
    label: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    ports: { id: string; name: string; side: "left" | "right" | "top" | "bottom"; offset: number }[];
  }[] = [];
  const edges: {
    id: string;
    source: string;
    sourcePort?: string;
    target: string;
    targetPort?: string;
    label?: string;
  }[] = [];

  const seenIds = new Set<string>();
  const addNode = (id: string, type: string, label?: string) => {
    const cleanId = id.trim();
    if (!cleanId || seenIds.has(cleanId) || nodes.length >= 24) return;
    seenIds.add(cleanId);
    const idx = nodes.length;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    nodes.push({
      id: cleanId,
      label: label || cleanId,
      type,
      position: { x: 60 + col * 210, y: 60 + row * 120 },
      size: { width: 150, height: 68 },
      ports: [
        { id: `${cleanId}.in`, name: "in", side: "left", offset: 0.5 },
        { id: `${cleanId}.out`, name: "out", side: "right", offset: 0.5 },
      ],
    });
  };

  // Extract declarations across Modelica, SysML v2, SSP, XML, etc.
  const declPatterns = [
    /\b(?:part|item|port|action|state|requirement|attribute|package|block|model|class|connector|record)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/g,
    /^\s*(?:parameter\s+|constant\s+|discrete\s+)?([A-Z][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|=|;)/gm,
    /<(?:ssd:Component|Component|SubSystem|SW-COMPONENT-PROTOTYPE|SPEC-OBJECT)\b[^>]*\b(?:name|id|SHORT-NAME)=["']([^"']+)["']/gi,
  ];
  for (const re of declPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[2]) {
        addNode(m[2], m[1] || dslLang, `${m[2]} : ${m[1]}`);
      } else if (m[1]) {
        addNode(m[1], dslLang, m[1]);
      }
    }
  }

  // Extract connections (connect(a.p, b.n), connect a to b, XML <ssd:Connection startElement="a" endElement="b">)
  const connRe =
    /\bconnect\s*\(\s*([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?\s*,\s*([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]+)?\s*\)/g;
  let cm: RegExpExecArray | null;
  while ((cm = connRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    addNode(src, dslLang);
    addNode(tgt, dslLang);
    edges.push({
      id: `e-${edges.length + 1}`,
      source: src,
      sourcePort: `${src}.out`,
      target: tgt,
      targetPort: `${tgt}.in`,
    });
  }

  const ssdConnRe = /<(?:ssd:)?Connection\b[^>]*startElement=["']([^"']+)["'][^>]*endElement=["']([^"']+)["']/gi;
  while ((cm = ssdConnRe.exec(content)) !== null) {
    const src = cm[1]!;
    const tgt = cm[2]!;
    addNode(src, "Component");
    addNode(tgt, "Component");
    edges.push({
      id: `e-${edges.length + 1}`,
      source: src,
      sourcePort: `${src}.out`,
      target: tgt,
      targetPort: `${tgt}.in`,
    });
  }

  void fallbackTitle;

  if (nodes.length === 0) {
    return {
      svg: "",
      nodeCount: 0,
      edgeCount: 0,
      nodes: [],
      edges: [],
      coordinateSystem: null,
      diagramBackground: null,
    };
  }

  return {
    svg: "",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    coordinateSystem: null,
    diagramBackground: null,
  };
}

interface FeaDeckLike {
  heading?: string | undefined;
  nodes?: Map<number, { id: number; x: number; y: number; z: number }> | undefined;
  elements?: Map<number, { id: number; type: string; nodes: number[] }> | undefined;
  materials?: Map<string, unknown> | undefined;
  steps?: { length?: number | undefined; size?: number | undefined } | undefined;
  boundaries?: { length?: number | undefined; size?: number | undefined } | undefined;
  cloads?: { length?: number | undefined; size?: number | undefined } | undefined;
  dloads?: { length?: number | undefined; size?: number | undefined } | undefined;
}

interface Su2ConfigLike {
  solver?: string | undefined;
  kindTurbModel?: string | undefined;
  mathProblem?: string | undefined;
  machNumber?: number | undefined;
  aoa?: number | undefined;
  reynoldsNumber?: number | undefined;
  markersEuler?: string[] | undefined;
  markersFar?: string[] | undefined;
  markersHeatflux?: string[] | undefined;
}

function buildFeaMeshSvgFromDeck(deck: FeaDeckLike, fallbackTitle: string): string {
  const width = 680;
  const height = 380;
  const pad = 48;
  const nodes: { id: number; x: number; y: number; z: number }[] = Array.from(deck.nodes?.values() ?? []);
  const elements: { id: number; type: string; nodes: number[] }[] = Array.from(deck.elements?.values() ?? []);
  const title = escapeXml(deck.heading || fallbackTitle);

  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
      <text x="24" y="32" fill="#e6edf3" font-family="monospace" font-size="13" font-weight="bold">FEA DECK // ${title}</text>
      <text x="24" y="60" fill="#8b949e" font-family="monospace" font-size="11">Materials: ${deck.materials?.size ?? 0} | Steps: ${deck.steps?.length ?? 0} | Boundaries: ${deck.boundaries?.length ?? 0}</text>
    </svg>`;
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2 - 30) / spanY);

  const project = (x: number, y: number): [number, number] => [
    +(pad + (x - minX) * scale).toFixed(1),
    +(height - pad - (y - minY) * scale).toFixed(1),
  ];

  const nodeMap = new Map<number, [number, number]>();
  for (const n of nodes) {
    nodeMap.set(n.id, project(n.x, n.y));
  }

  const polys: string[] = [];
  for (const el of elements.slice(0, 600)) {
    const pts = el.nodes.map((nid) => nodeMap.get(nid)).filter(Boolean) as [number, number][];
    if (pts.length >= 3) {
      polys.push(
        `<polygon points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="rgba(56, 189, 248, 0.12)" stroke="#38bdf8" stroke-width="1" />`,
      );
    } else if (pts.length === 2) {
      polys.push(
        `<line x1="${pts[0]![0]}" y1="${pts[0]![1]}" x2="${pts[1]![0]}" y2="${pts[1]![1]}" stroke="#38bdf8" stroke-width="1.5" />`,
      );
    }
  }

  const dots: string[] = [];
  for (const n of nodes.slice(0, 400)) {
    const pt = nodeMap.get(n.id);
    if (pt) {
      dots.push(`<circle cx="${pt[0]}" cy="${pt[1]}" r="2" fill="#e2e8f0" />`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="20" y="26" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">FEA MESH // ${title}</text>
    <text x="20" y="44" fill="#8b949e" font-family="monospace" font-size="10">Nodes: ${nodes.length} | Elements: ${elements.length} | Materials: ${deck.materials?.size ?? 0} | Steps: ${deck.steps?.length ?? 0}</text>
    ${polys.join("\n    ")}
    ${dots.join("\n    ")}
  </svg>`;
}

function buildCsvTelemetrySvg(headers: string[], rows: number[][], fallbackTitle: string): string {
  const width = 680;
  const height = 360;
  const padX = 56;
  const padTop = 68;
  const padBot = 42;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBot;
  const palette = ["#38bdf8", "#34d399", "#f43f5e", "#f59e0b", "#a855f7"];

  const seriesIndices: number[] = [];
  for (let c = 1; c < headers.length && seriesIndices.length < 4; c++) {
    seriesIndices.push(c);
  }
  if (seriesIndices.length === 0 && headers.length > 0) {
    seriesIndices.push(0);
  }

  const polylines: string[] = [];
  const legendItems: string[] = [];

  seriesIndices.forEach((colIdx, sIdx) => {
    const color = palette[sIdx % palette.length]!;
    const vals = rows.map((r) => r[colIdx] ?? 0).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return;
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1e-6, maxV - minV);
    const pts = vals.map((v, i) => {
      const x = +(padX + (i / Math.max(1, vals.length - 1)) * plotW).toFixed(1);
      const y = +(padTop + plotH - ((v - minV) / span) * plotH).toFixed(1);
      return `${x},${y}`;
    });
    polylines.push(
      `<polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}" />`,
    );
    const label = escapeXml(headers[colIdx] || `col_${colIdx}`);
    const lx = padX + sIdx * 145;
    legendItems.push(
      `<rect x="${lx}" y="${height - 24}" width="10" height="10" rx="2" fill="${color}" /><text x="${lx + 15}" y="${height - 15}" fill="#cbd5e1" font-family="monospace" font-size="10">${label}</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="24" y="28" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">CSV TELEMETRY // ${escapeXml(fallbackTitle)}</text>
    <text x="24" y="46" fill="#38bdf8" font-family="monospace" font-size="11">Channels: ${headers.length} | Samples: ${rows.length} | Normalized Multi-Trace Overlay</text>
    <rect x="${padX}" y="${padTop}" width="${plotW}" height="${plotH}" rx="4" fill="rgba(15, 23, 42, 0.65)" stroke="#1e293b" stroke-width="1"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.25}" x2="${padX + plotW}" y2="${padTop + plotH * 0.25}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.5}" x2="${padX + plotW}" y2="${padTop + plotH * 0.5}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.75}" x2="${padX + plotW}" y2="${padTop + plotH * 0.75}" stroke="#1e293b" stroke-dasharray="4 4"/>
    ${polylines.join("\n    ")}
    ${legendItems.join("\n    ")}
  </svg>`;
}

export interface StepSvgPreviewResult {
  svg: string;
  title: string;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
}

/**
 * Deterministically parses ISO-10303-21 STEP B-Rep entities (`CARTESIAN_POINT`,
 * `VERTEX_POINT`, `EDGE_CURVE`, `ORIENTED_EDGE`, `EDGE_LOOP`) and renders a
 * depth-sorted isometric shaded 3D CAD assembly SVG thumbnail.
 */
export function renderStepIsometricSvg(stepContent: string, fallbackTitle = "CAD Assembly"): StepSvgPreviewResult {
  const width = 800;
  const height = 450;

  const fileDescMatch = /FILE_NAME\s*\(\s*'([^']+)'/i.exec(stepContent);
  const rawName = fileDescMatch?.[1] ? path.parse(fileDescMatch[1]).name : fallbackTitle;
  const displayTitle = escapeXml(fallbackTitle || rawName || "CAD Assembly");

  const cartesianPoints = new Map<number, [number, number, number]>();
  const ptRe =
    /#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = ptRe.exec(stepContent)) !== null) {
    const id = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const z = Number(m[4]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      cartesianPoints.set(id, [x, y, z]);
    }
  }

  const vertexPoints = new Map<number, [number, number, number]>();
  const vpRe = /#(\d+)\s*=\s*VERTEX_POINT\s*\([^,]*,\s*#(\d+)\s*\)/g;
  while ((m = vpRe.exec(stepContent)) !== null) {
    const vid = Number(m[1]);
    const pid = Number(m[2]);
    const pt = cartesianPoints.get(pid);
    if (pt) {
      vertexPoints.set(vid, pt);
    }
  }

  const edgeCurves = new Map<number, [[number, number, number], [number, number, number]]>();
  const ecRe = /#(\d+)\s*=\s*EDGE_CURVE\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)/g;
  while ((m = ecRe.exec(stepContent)) !== null) {
    const eid = Number(m[1]);
    const v1 = vertexPoints.get(Number(m[2])) ?? cartesianPoints.get(Number(m[2]));
    const v2 = vertexPoints.get(Number(m[3])) ?? cartesianPoints.get(Number(m[3]));
    if (v1 && v2) {
      edgeCurves.set(eid, [v1, v2]);
    }
  }

  const orientedEdges = new Map<number, { edgeId: number; forward: boolean }>();
  const oeRe = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*\.(T|F)\./g;
  while ((m = oeRe.exec(stepContent)) !== null) {
    orientedEdges.set(Number(m[1]), {
      edgeId: Number(m[2]),
      forward: m[3] === "T",
    });
  }

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  const faces: [number, number, number][][] = [];
  const elRe = /#(\d+)\s*=\s*EDGE_LOOP\s*\([^,]*,\s*\(([^)]+)\)\s*\)/g;
  while ((m = elRe.exec(stepContent)) !== null) {
    const refs = m[2]!.match(/#(\d+)/g);
    if (!refs || refs.length < 3) continue;
    const segs: [[number, number, number], [number, number, number]][] = [];
    for (const ref of refs) {
      const refId = Number(ref.slice(1));
      const oe = orientedEdges.get(refId);
      if (oe) {
        const curve = edgeCurves.get(oe.edgeId);
        if (curve) {
          segs.push(oe.forward ? [curve[0], curve[1]] : [curve[1], curve[0]]);
        }
      } else {
        const curve = edgeCurves.get(refId);
        if (curve) {
          segs.push([curve[0], curve[1]]);
        }
      }
    }
    if (segs.length < 2) continue;

    const poly: [number, number, number][] = [];
    let firstSeg = segs[0]!;
    const secondSeg = segs[1]!;
    const dEnd = Math.min(dist3(firstSeg[1], secondSeg[0]), dist3(firstSeg[1], secondSeg[1]));
    const dStart = Math.min(dist3(firstSeg[0], secondSeg[0]), dist3(firstSeg[0], secondSeg[1]));
    if (dStart + 1e-6 < dEnd) {
      firstSeg = [firstSeg[1], firstSeg[0]];
    }
    pushUniquePt(poly, firstSeg[0]);
    pushUniquePt(poly, firstSeg[1]);

    for (let i = 1; i < segs.length; i++) {
      let seg = segs[i]!;
      const lastPt = poly[poly.length - 1]!;
      if (dist3(lastPt, seg[1]) + 1e-6 < dist3(lastPt, seg[0])) {
        seg = [seg[1], seg[0]];
      }
      pushUniquePt(poly, seg[0]);
      pushUniquePt(poly, seg[1]);
    }

    if (poly.length >= 2 && dist3(poly[0]!, poly[poly.length - 1]!) < 1e-5) {
      poly.pop();
    }
    if (poly.length >= 3) {
      faces.push(poly);
    }
  }

  // Compute 3D bounding box over all vertex/cartesian points
  const allPts = vertexPoints.size > 0 ? Array.from(vertexPoints.values()) : Array.from(cartesianPoints.values());

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of allPts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) * 0.5 : 0;
  const cz = Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : 0;

  // Trimetric CAD projection (assuming Y-up or Z-up, tilted so all 3 axes have clear separation)
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const zUp = spanZ < spanY * 0.4; // If Z is thin (e.g. FEA/CFD XY plane with Z thickness), treat Z as vertical
  const isoProjectRaw = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = zUp ? p[2] - cz : p[1] - cy;
    const dz = zUp ? -(p[1] - cy) : p[2] - cz;
    // Rotate yaw 38 deg, pitch 28 deg
    const cosY = 0.78801;
    const sinY = 0.61566;
    const cosP = 0.88295;
    const sinP = 0.46947;
    const rx = dx * cosY + dz * sinY;
    const rz = -dx * sinY + dz * cosY;
    const ry = dy * cosP - rz * sinP;
    const depth = dy * sinP + rz * cosP;
    return [rx, -ry, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of allPts) {
    const [px, py] = isoProjectRaw(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-5, pMaxX - pMinX);
  const pSpanY = Math.max(1e-5, pMaxY - pMinY);
  const padX = 90;
  const padY = 72;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProjectRaw(p);
    return [
      +(width * 0.5 + (rx - midPX) * scale).toFixed(1),
      +(height * 0.52 + (ry - midPY) * scale).toFixed(1),
      depth,
    ];
  };

  const renderedElements: string[] = [];

  if (faces.length > 0) {
    interface ProjectedFace {
      pts2d: [number, number][];
      depth: number;
      fill: string;
      stroke: string;
    }
    const projFaces: ProjectedFace[] = [];
    for (const poly of faces.slice(0, 1500)) {
      const proj = poly.map(projectScreen);
      let sumDepth = 0;
      for (const p of proj) sumDepth += p[2];
      const avgDepth = sumDepth / proj.length;

      // Face normal via cross product of first 3 non-collinear vertices
      const p0 = poly[0]!;
      const p1 = poly[1]!;
      const p2 = poly[2]!;
      const ux = p1[0] - p0[0],
        uy = p1[1] - p0[1],
        uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0],
        vy = p2[1] - p0[1],
        vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      // Key light from top-right-front
      const lightDot = Math.abs(nx * 0.45 + ny * 0.72 + nz * 0.52);
      const intensity = Math.min(1, Math.max(0.2, 0.25 + lightDot * 0.75));
      const r = Math.round(42 + intensity * 62);
      const g = Math.round(68 + intensity * 84);
      const b = Math.round(98 + intensity * 102);

      projFaces.push({
        pts2d: proj.map((p) => [p[0], p[1]]),
        depth: avgDepth,
        fill: `rgba(${r}, ${g}, ${b}, 0.94)`,
        stroke: `rgba(30, 41, 59, ${+(0.35 + intensity * 0.25).toFixed(2)})`,
      });
    }

    projFaces.sort((a, b) => a.depth - b.depth);
    for (const f of projFaces) {
      renderedElements.push(
        `<polygon points="${f.pts2d.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="0.85" stroke-linejoin="round" />`,
      );
    }
  } else if (edgeCurves.size > 0) {
    for (const [v1, v2] of Array.from(edgeCurves.values()).slice(0, 1200)) {
      const p1 = projectScreen(v1);
      const p2 = projectScreen(v2);
      renderedElements.push(
        `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#334155" stroke-width="1.2" opacity="0.85" />`,
      );
    }
  }

  void displayTitle;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Projected B-Rep Geometry -->
  <g>
    ${renderedElements.join("\n    ")}
  </g>
</svg>`;

  return {
    svg,
    title: rawName,
    vertexCount: vertexPoints.size || cartesianPoints.size,
    edgeCount: edgeCurves.size,
    faceCount: faces.length,
  };
}

export interface VtuSvgPreviewResult {
  svg: string;
  pointCount: number;
  cellCount: number;
  fieldName: string;
  minValue: number;
  maxValue: number;
}

function sampleScientificColormap(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  // 5-stop scientific rainbow/turbo ramp: deep blue -> cyan -> green -> amber -> crimson
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 64, 175]],
    [0.25, [14, 165, 233]],
    [0.5, [16, 185, 129]],
    [0.75, [245, 158, 11]],
    [1.0, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (clamped >= t0 && clamped <= t1) {
      const u = (clamped - t0) / Math.max(1e-6, t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return [239, 68, 68];
}

/**
 * Deterministically parses an UnstructuredGrid VTU XML string (`<Points>`, `<Cells>`,
 * `<PointData>`) and renders a depth-sorted isometric 3D finite-element contour mesh
 * SVG on a uniform radial greyscale background.
 */
export function renderVtuIsometricSvg(
  vtuXml: string,
  fallbackTitle = "Simulation Result",
  fieldUnits?: Record<string, string>,
): VtuSvgPreviewResult {
  const width = 800;
  const height = 450;
  void fallbackTitle;
  void fieldUnits;

  const pointsMatch = /<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/i.exec(vtuXml);
  const rawCoordNumbers = pointsMatch?.[1]
    ? pointsMatch[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];

  const points: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawCoordNumbers.length; i += 3) {
    points.push([rawCoordNumbers[i]!, rawCoordNumbers[i + 1]!, rawCoordNumbers[i + 2]!]);
  }

  const connMatch = /<DataArray[^>]*Name=["']connectivity["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(vtuXml);
  const offsetsMatch = /<DataArray[^>]*Name=["']offsets["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(vtuXml);

  const connectivity = connMatch?.[1]
    ? connMatch[1]
        .trim()
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : [];
  const offsets = offsetsMatch?.[1]
    ? offsetsMatch[1]
        .trim()
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : [];

  // Extract first PointData or CellData array
  const pointDataBlock = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(vtuXml)?.[1] ?? vtuXml;
  const dataArrayMatch = /<DataArray[^>]*Name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(pointDataBlock);
  const fieldName = dataArrayMatch?.[1] || "ScalarField";
  const numCompsMatch = dataArrayMatch?.[0] ? /NumberOfComponents=["'](\d+)["']/i.exec(dataArrayMatch[0]) : null;
  const numComps = numCompsMatch ? Math.max(1, Number.parseInt(numCompsMatch[1]!, 10)) : 1;

  const rawFieldVals = dataArrayMatch?.[2]
    ? dataArrayMatch[2]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];

  const nodalScalars: number[] = [];
  if (numComps === 1) {
    for (const v of rawFieldVals) nodalScalars.push(v);
  } else {
    for (let i = 0; i + numComps - 1 < rawFieldVals.length; i += numComps) {
      let sumSq = 0;
      for (let c = 0; c < numComps; c++) {
        const compVal = rawFieldVals[i + c] ?? 0;
        sumSq += compVal * compVal;
      }
      nodalScalars.push(Math.sqrt(sumSq));
    }
  }

  // Optional 3-component Velocity vector array for aerodynamic streamlines
  const velocityMatch =
    /<DataArray[^>]*Name=["']Velocity["'][^>]*NumberOfComponents=["']3["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(
      pointDataBlock,
    ) ??
    /<DataArray[^>]*NumberOfComponents=["']3["'][^>]*Name=["']Velocity["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(
      pointDataBlock,
    );
  const rawVelVals = velocityMatch?.[1]
    ? velocityMatch[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : [];
  const velocityVectors: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawVelVals.length; i += 3) {
    velocityVectors.push([rawVelVals[i]!, rawVelVals[i + 1]!, rawVelVals[i + 2]!]);
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of nodalScalars) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  if (!Number.isFinite(minVal)) minVal = 0;
  if (!Number.isFinite(maxVal)) maxVal = 1;

  // Build boundary/cell faces
  const triFaces: [number, number, number][] = [];
  let prevOffset = 0;
  for (const endOffset of offsets) {
    const cellNodes = connectivity.slice(prevOffset, endOffset);
    prevOffset = endOffset;
    if (cellNodes.length === 4) {
      const [n0, n1, n2, n3] = cellNodes as [number, number, number, number];
      triFaces.push([n0, n1, n2], [n0, n1, n3], [n0, n2, n3], [n1, n2, n3]);
    } else if (cellNodes.length === 3) {
      triFaces.push([cellNodes[0]!, cellNodes[1]!, cellNodes[2]!]);
    } else if (cellNodes.length >= 4) {
      for (let k = 1; k + 1 < cellNodes.length; k++) {
        triFaces.push([cellNodes[0]!, cellNodes[k]!, cellNodes[k + 1]!]);
      }
    }
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) * 0.5 : 0;
  const cz = Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : 0;

  // Isometric camera with Z-up orientation (standard for FEA/CFD XY chassis meshes)
  const isoProject = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const cosA = 0.76604; // 40 deg
    const sinA = 0.64279;
    const cosP = 0.81915; // 35 deg pitch
    const sinP = 0.57358;
    const rx = dx * cosA - dy * sinA;
    const ryPlanar = dx * sinA + dy * cosA;
    const sy = dz * cosP - ryPlanar * sinP;
    const depth = dz * sinP + ryPlanar * cosP;
    return [rx, -sy, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of points) {
    const [px, py] = isoProject(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const padX = 85;
  const padY = 54;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProject(p);
    return [+(width * 0.5 + (rx - midPX) * scale).toFixed(1), +(height * 0.5 + (ry - midPY) * scale).toFixed(1), depth];
  };

  interface ShadedTri {
    pts: [[number, number], [number, number], [number, number]];
    depth: number;
    fill: string;
    stroke: string;
  }

  const shadedTris: ShadedTri[] = [];
  const valSpan = Math.max(1e-9, maxVal - minVal);

  for (const [i0, i1, i2] of triFaces.slice(0, 1600)) {
    const v0 = points[i0];
    const v1 = points[i1];
    const v2 = points[i2];
    if (!v0 || !v1 || !v2) continue;

    const s0 = projectScreen(v0);
    const s1 = projectScreen(v1);
    const s2 = projectScreen(v2);
    const avgDepth = (s0[2] + s1[2] + s2[2]) / 3;

    const f0 = nodalScalars[i0] ?? minVal;
    const f1 = nodalScalars[i1] ?? minVal;
    const f2 = nodalScalars[i2] ?? minVal;
    const avgScalar = (f0 + f1 + f2) / 3;
    const normT = (avgScalar - minVal) / valSpan;

    const [cr, cg, cb] = sampleScientificColormap(normT);

    // Compute normal shading
    const ux = v1[0] - v0[0],
      uy = v1[1] - v0[1],
      uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0],
      vy = v2[1] - v0[1],
      vz = v2[2] - v0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const shade = 0.68 + 0.32 * Math.abs(nx * 0.35 + ny * 0.45 + nz * 0.82);

    const r = Math.min(255, Math.round(cr * shade));
    const g = Math.min(255, Math.round(cg * shade));
    const b = Math.min(255, Math.round(cb * shade));

    shadedTris.push({
      pts: [
        [s0[0], s0[1]],
        [s1[0], s1[1]],
        [s2[0], s2[1]],
      ],
      depth: avgDepth,
      fill: `rgb(${r}, ${g}, ${b})`,
      stroke: `rgba(15, 23, 42, 0.32)`,
    });
  }

  shadedTris.sort((a, b) => a.depth - b.depth);

  // Optional aerodynamic flow streamlines if Velocity field is present
  const streakLines: string[] = [];
  if (velocityVectors.length > 0 && points.length > 0) {
    let vMin = Infinity;
    let vMax = -Infinity;
    const vMags: number[] = [];
    for (const [vx, vy, vz] of velocityVectors) {
      const mag = Math.hypot(vx, vy, vz);
      vMags.push(mag);
      if (mag < vMin) vMin = mag;
      if (mag > vMax) vMax = mag;
    }
    const vSpan = Math.max(1e-6, vMax - vMin);
    const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const streakScale = (bboxDiag * 0.22) / Math.max(1e-6, vMax);
    const step = Math.max(1, Math.floor(points.length / 64));
    for (let i = 0; i < points.length && i < velocityVectors.length; i += step) {
      const pt = points[i]!;
      const vel = velocityVectors[i]!;
      const mag = vMags[i] ?? 0;
      if (mag <= 1e-5) continue;
      const pStart: [number, number, number] = [
        pt[0] - vel[0] * streakScale * 0.45,
        pt[1] - vel[1] * streakScale * 0.45,
        pt[2] - vel[2] * streakScale * 0.45,
      ];
      const pEnd: [number, number, number] = [
        pt[0] + vel[0] * streakScale * 0.55,
        pt[1] + vel[1] * streakScale * 0.55,
        pt[2] + vel[2] * streakScale * 0.55,
      ];
      const sA = projectScreen(pStart);
      const sB = projectScreen(pEnd);
      const [sr, sg, sb] = sampleScientificColormap((mag - vMin) / vSpan);
      streakLines.push(
        `<line x1="${sA[0]}" y1="${sA[1]}" x2="${sB[0]}" y2="${sB[1]}" stroke="rgba(${sr}, ${sg}, ${sb}, 0.72)" stroke-width="1.25" stroke-linecap="round" />`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Finite-Element Contour Mesh -->
  <g>
    ${shadedTris
      .map(
        (t) =>
          `<polygon points="${t.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="0.6" stroke-linejoin="round" />`,
      )
      .join("\n    ")}
  </g>
  ${streakLines.length > 0 ? `<g>\n    ${streakLines.join("\n    ")}\n  </g>` : ""}
</svg>`;

  return {
    svg,
    pointCount: points.length,
    cellCount: offsets.length,
    fieldName,
    minValue: minVal,
    maxValue: maxVal,
  };
}

/**
 * Deterministically renders an isometric 3D CFD melt-front animation preview SVG
 * on the uniform radial greyscale background.
 */
export function renderCfdAnimationIsometricSvg(
  frames: {
    time?: number | undefined;
    geometry?: { positions?: number[] | undefined; indices?: number[] | undefined } | undefined;
    fields?: Record<string, number[] | undefined> | undefined;
  }[],
  moldGeometry?: { length?: number | undefined; width?: number | undefined; height?: number | undefined } | undefined,
): { svg: string; vertexCount: number; frameCount: number } {
  const width = 800;
  const height = 450;

  const f0 = frames[0];
  const rawPositions = f0?.geometry?.positions ?? [];
  const rawIndices = f0?.geometry?.indices ?? [];

  const points: [number, number, number][] = [];
  for (let i = 0; i + 2 < rawPositions.length; i += 3) {
    points.push([rawPositions[i]!, rawPositions[i + 1]!, rawPositions[i + 2]!]);
  }

  // Pick a representative mid-fill frame (~38% through the fill sequence)
  const targetFrameIdx = frames.length > 1 ? Math.min(frames.length - 1, Math.floor(frames.length * 0.38)) : 0;
  const activeFrame = frames[targetFrameIdx] ?? f0;
  const alphaField = activeFrame?.fields?.["alpha.polymer"] ?? [];
  const tempField = activeFrame?.fields?.["temperature"] ?? [];

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX)) {
    const mLen = moldGeometry?.length ?? 0.15;
    const mWid = moldGeometry?.width ?? 0.1;
    const mHei = moldGeometry?.height ?? 0.02;
    minX = -mLen * 0.5;
    maxX = mLen * 0.5;
    minY = -mWid * 0.5;
    maxY = mWid * 0.5;
    minZ = -mHei * 0.5;
    maxZ = mHei * 0.5;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const isoProject = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const cosA = 0.81915; // 35 deg
    const sinA = 0.57358;
    const cosP = 0.84805; // 32 deg pitch
    const sinP = 0.52992;
    const rx = dx * cosA - dy * sinA;
    const ryPlanar = dx * sinA + dy * cosA;
    const sy = dz * cosP - ryPlanar * sinP;
    const depth = dz * sinP + ryPlanar * cosP;
    return [rx, -sy, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of points) {
    const [px, py] = isoProject(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }
  if (!Number.isFinite(pMinX)) {
    pMinX = -0.1;
    pMaxX = 0.1;
    pMinY = -0.06;
    pMaxY = 0.06;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const padX = 110;
  const padY = 64;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProject(p);
    return [+(width * 0.5 + (rx - midPX) * scale).toFixed(1), +(height * 0.5 + (ry - midPY) * scale).toFixed(1), depth];
  };

  const sampleMeltColor = (alpha: number, temp: number): [number, number, number] => {
    if (alpha < 0.01) {
      return [45, 55, 72];
    }
    const t = Math.max(0, Math.min(1, (temp - 300) / 213));
    const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
    const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
    const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
    let cr = Math.round(r * 255);
    let cg = Math.round(g * 255);
    let cb = Math.round(b * 255);
    if (alpha < 0.5) {
      const u = alpha / 0.5;
      cr = Math.round(45 * (1 - u) + cr * u);
      cg = Math.round(55 * (1 - u) + cg * u);
      cb = Math.round(72 * (1 - u) + cb * u);
    }
    return [cr, cg, cb];
  };

  interface ShadedTri {
    pts: [[number, number], [number, number], [number, number]];
    depth: number;
    fill: string;
  }

  const totalTris = Math.floor(rawIndices.length / 3);
  const triStride = Math.max(1, Math.floor(totalTris / 2400));
  const shadedTris: ShadedTri[] = [];

  for (let tIdx = 0; tIdx < totalTris; tIdx += triStride) {
    const base = tIdx * 3;
    const i0 = rawIndices[base]!;
    const i1 = rawIndices[base + 1]!;
    const i2 = rawIndices[base + 2]!;
    const v0 = points[i0];
    const v1 = points[i1];
    const v2 = points[i2];
    if (!v0 || !v1 || !v2) continue;

    const s0 = projectScreen(v0);
    const s1 = projectScreen(v1);
    const s2 = projectScreen(v2);
    const avgDepth = (s0[2] + s1[2] + s2[2]) / 3;

    const a0 = alphaField[i0] ?? 0;
    const a1 = alphaField[i1] ?? 0;
    const a2 = alphaField[i2] ?? 0;
    const avgAlpha = (a0 + a1 + a2) / 3;

    const t0 = tempField[i0] ?? 420;
    const t1 = tempField[i1] ?? 420;
    const t2 = tempField[i2] ?? 420;
    const avgTemp = (t0 + t1 + t2) / 3;

    const [cr, cg, cb] = sampleMeltColor(avgAlpha, avgTemp);

    const ux = v1[0] - v0[0],
      uy = v1[1] - v0[1],
      uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0],
      vy = v2[1] - v0[1],
      vz = v2[2] - v0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const shade = 0.72 + 0.28 * Math.abs(nx * 0.35 + ny * 0.45 + nz * 0.82);

    const r = Math.min(255, Math.round(cr * shade));
    const g = Math.min(255, Math.round(cg * shade));
    const b = Math.min(255, Math.round(cb * shade));

    shadedTris.push({
      pts: [
        [s0[0], s0[1]],
        [s1[0], s1[1]],
        [s2[0], s2[1]],
      ],
      depth: avgDepth,
      fill: `rgb(${r}, ${g}, ${b})`,
    });
  }

  shadedTris.sort((a, b) => a.depth - b.depth);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Melt-Front Cavity Mesh -->
  <g>
    ${shadedTris
      .map(
        (t) =>
          `<polygon points="${t.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.8" stroke-linejoin="round" />`,
      )
      .join("\n    ")}
  </g>
</svg>`;

  return {
    svg,
    vertexCount: points.length,
    frameCount: frames.length,
  };
}
