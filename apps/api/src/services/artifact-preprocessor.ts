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
        const { evaluateOffsetLimits, parseSimaFile, verifyDnvMooringCompliance } = await import("@modelscript/sima");
        const { renderSimaMooringSpreadSvg } = await import("@modelscript/diagram/sima-diagram-builder");

        const model = parseSimaFile(content);
        const linesCount = model.lines?.length || 0;
        const waterDepth = model.environment?.waterDepth || 100;
        const dnvReport = verifyDnvMooringCompliance(model);
        const offsetReport = evaluateOffsetLimits(model);
        const maxTensionKn =
          dnvReport.lines.length > 0
            ? Math.round(Math.max(...dnvReport.lines.map((r) => r.tensionIntact)) / 1000)
            : undefined;

        const svg = renderSimaMooringSpreadSvg({
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring Spread` : `${baseTitle} Mooring Spread`,
          waterDepth,
          vesselName: model.vessels[0]?.name ?? baseTitle,
          watchCircleRadius: offsetReport.watchCircleRadiusMeters || +(waterDepth * 0.08).toFixed(1),
          vesselOffset: offsetReport.meanOffsetMeters,
          fairleads: model.vessels[0]?.fairleads,
          environment: {
            waveDir: model.environment?.wave?.direction,
            waveHs: model.environment?.wave?.hs,
            waveTp: model.environment?.wave?.tp,
            windDir: model.environment?.wind?.direction,
            windSpeed: model.environment?.wind?.speed,
            currentDir: model.environment?.current?.direction,
            currentSpeed: model.environment?.current?.surfaceSpeed,
          },
          lines: (model.lines || []).map((l, i) => {
            const dnvLine = dnvReport.lines[i];
            const hasExplicitAnchor = l.anchorPosition !== undefined;
            const fallbackRad = (2 * Math.PI * i) / Math.max(1, linesCount);
            const fallbackR = l.totalLength || waterDepth * 2.5;
            const ancX = hasExplicitAnchor ? (l.anchorPosition[0] ?? 0) : Math.round(fallbackR * Math.cos(fallbackRad));
            const ancY = hasExplicitAnchor ? (l.anchorPosition[1] ?? 0) : Math.round(fallbackR * Math.sin(fallbackRad));
            const ancZ = l.anchorPosition?.[2] ?? -waterDepth;
            return {
              id: l.id || `line-${i + 1}`,
              name: l.name || `Line #${i + 1}`,
              fairleadId: l.fairleadId,
              ...(l.fairleadPosition ? { fairleadPos: l.fairleadPosition } : {}),
              anchorPos: [ancX, ancY, ancZ] as [number, number, number],
              tension: dnvLine?.tensionIntact ?? l.pretension ?? 0,
              mbl: dnvLine?.mbl ?? l.segments[0]?.mbl ?? 0,
              safetyFactor: dnvLine?.safetyFactorIntact,
              segmentCount: l.segments.length,
              totalLength: l.totalLength,
            };
          }),
        });

        result.svg = svg;
        result.metadata = {
          waterDepth,
          lineCount: linesCount,
          vesselName: model.vessels[0]?.name,
          dnvCompliant: dnvReport.summary.allPassed,
          minSafetyFactor: +dnvReport.summary.minSafetyFactor.toFixed(2),
          ...(maxTensionKn !== undefined ? { maxTensionKn } : {}),
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          waterDepthMeters: waterDepth,
          mooringLinesCount: linesCount,
          watchCircleRadiusMeters: offsetReport.watchCircleRadiusMeters,
          dnvCompliant: dnvReport.summary.allPassed,
          minSafetyFactor: +dnvReport.summary.minSafetyFactor.toFixed(2),
          ...(maxTensionKn !== undefined ? { maxTensionKn } : {}),
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
          data?: { kind?: string | undefined; type?: string | undefined } | undefined;
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

        const extractOwl2AxiomsFromText = (src: string) => {
          const extracted: Record<string, unknown>[] = [];
          for (const m of src.matchAll(/\bDeclaration\s*\(\s*Class\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
            extracted.push({ type: "ClassDeclaration", iri: m[1]! });
          }
          for (const m of src.matchAll(/\bDeclaration\s*\(\s*ObjectProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
            extracted.push({ type: "ObjectPropertyDeclaration", iri: m[1]! });
          }
          for (const m of src.matchAll(/\bDeclaration\s*\(\s*DataProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
            extracted.push({ type: "DataPropertyDeclaration", iri: m[1]! });
          }
          for (const m of src.matchAll(/\bDeclaration\s*\(\s*NamedIndividual\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
            extracted.push({ type: "IndividualDeclaration", iri: m[1]! });
          }
          for (const m of src.matchAll(/\bSubClassOf\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
            extracted.push({ type: "SubClassOf", subClassIri: m[1]!, superClassIri: m[2]! });
          }
          for (const m of src.matchAll(/\bDisjointClasses\s*\(([^)]+)\)/g)) {
            const classIris = m[1]!.trim().split(/\s+/).filter(Boolean);
            if (classIris.length >= 2) extracted.push({ type: "DisjointClasses", classIris });
          }
          for (const m of src.matchAll(
            /\bInverseObjectProperties\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g,
          )) {
            extracted.push({ type: "InverseObjectProperties", propertyIri: m[1]!, inversePropertyIri: m[2]! });
          }
          for (const m of src.matchAll(/\bObjectPropertyDomain\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
            extracted.push({ type: "ObjectPropertyDomain", propertyIri: m[1]!, domainIri: m[2]! });
          }
          for (const m of src.matchAll(/\bObjectPropertyRange\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
            extracted.push({ type: "ObjectPropertyRange", propertyIri: m[1]!, rangeIri: m[2]! });
          }
          for (const m of src.matchAll(/\bClassAssertion\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
            extracted.push({ type: "ClassAssertion", classIri: m[1]!, individualIri: m[2]! });
          }
          for (const m of src.matchAll(
            /\bObjectPropertyAssertion\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g,
          )) {
            extracted.push({
              type: "ObjectPropertyAssertion",
              propertyIri: m[1]!,
              subjectIri: m[2]!,
              objectIri: m[3]!,
            });
          }
          return extracted;
        };

        const ontIriMatch = content.match(/Ontology\s*\(\s*<([^>]+)>/);
        const ontology = owlMod.parseOWL2
          ? owlMod.parseOWL2(content)
          : { axioms: extractOwl2AxiomsFromText(content), iri: ontIriMatch?.[1] || baseTitle };
        const diag: Owl2DiagramLike =
          owlMod.buildOWL2DiagramData && (ontology.axioms?.length ?? 0) > 0
            ? owlMod.buildOWL2DiagramData(ontology.axioms || [])
            : buildPolyglotDiagramFromSource(content, "owl2", baseTitle);
        result.svg = renderPolyglotDiagramToSvg(diag as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0], {
          theme: "dark",
        });
        const classCount = (diag.nodes || []).filter(
          (n) => n.kind === "class" || n.type === "class" || n.data?.kind === "class" || n.data?.type === "class",
        ).length;
        const indivCount = (diag.nodes || []).filter(
          (n) =>
            n.kind === "individual" ||
            n.type === "individual" ||
            n.data?.kind === "individual" ||
            n.data?.type === "individual",
        ).length;
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

      case "verilog-a": {
        const { parseVerilogA } = await import("@modelscript/verilog-a");
        const { buildVerilogADiagram, renderVerilogASvg } =
          await import("@modelscript/diagram/verilog-a-diagram-builder");
        const doc = parseVerilogA(content);
        const diag = buildVerilogADiagram(doc as unknown as Parameters<typeof buildVerilogADiagram>[0]);
        result.svg = renderVerilogASvg(doc as unknown as Parameters<typeof renderVerilogASvg>[0]);
        result.metadata = {
          dialect: "verilog-a",
          portCount: diag.metadata.portCount,
          branchCount: diag.metadata.branchCount,
          parameterCount: diag.metadata.parameterCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "verilog-a",
          portCount: diag.metadata.portCount,
          branchCount: diag.metadata.branchCount,
          parameterCount: diag.metadata.parameterCount,
        };
        break;
      }

      case "autosar": {
        const { parseArxml } = await import("@modelscript/autosar");
        const { buildAutosarDiagram, renderAutosarSvg } = await import("@modelscript/diagram/autosar-diagram-builder");
        const model = parseArxml(content);
        const diag = buildAutosarDiagram(model as unknown as Parameters<typeof buildAutosarDiagram>[0]);
        result.svg = renderAutosarSvg(model as unknown as Parameters<typeof renderAutosarSvg>[0]);
        result.metadata = {
          dialect: "autosar",
          componentCount: diag.metadata.componentCount,
          portCount: diag.metadata.portCount,
          runnableCount: diag.metadata.runnableCount,
          connectorCount: diag.metadata.connectorCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "autosar",
          componentCount: diag.metadata.componentCount,
          portCount: diag.metadata.portCount,
          runnableCount: diag.metadata.runnableCount,
          connectorCount: diag.metadata.connectorCount,
        };
        break;
      }

      case "plcopen": {
        const { parsePlcopen } = await import("@modelscript/plcopen");
        const { buildPlcopenDiagram, renderPlcopenSvg } = await import("@modelscript/diagram/plcopen-diagram-builder");
        const project = parsePlcopen(content, originalFilename);
        const diag = buildPlcopenDiagram(project as unknown as Parameters<typeof buildPlcopenDiagram>[0]);
        result.svg = renderPlcopenSvg(project as unknown as Parameters<typeof renderPlcopenSvg>[0]);
        result.metadata = {
          dialect: "plcopen",
          pouCount: diag.metadata.pouCount,
          inputCount: diag.metadata.inputCount,
          outputCount: diag.metadata.outputCount,
          networkCount: diag.metadata.networkCount,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "plcopen",
          pouName: diag.pouName,
          pouType: diag.pouType,
          blockCount: diag.metadata.networkCount,
          portCount: diag.metadata.inputCount + diag.metadata.outputCount,
          inputCount: diag.metadata.inputCount,
          outputCount: diag.metadata.outputCount,
        };
        break;
      }

      case "fortran":
      case "c":
      case "scad":
      case "csg":
      case "ccsds":
      case "energyplus":
      case "reqif": {
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
      case "sysml2": {
        const sysmlRes = buildSysmlArchitectureFromSource(content, baseTitle);
        if (sysmlRes.svg) {
          result.svg = sysmlRes.svg;
        }
        result.metadata = {
          nodeCount: sysmlRes.parts.length,
          connectionCount: sysmlRes.connections.length,
          requirementCount: sysmlRes.requirements.length,
          dialect: "sysml2",
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          systemName: sysmlRes.packageName || baseTitle,
          rootPartDef: sysmlRes.rootPartDef,
          dialect: "sysml2",
          nodeCount: sysmlRes.parts.length,
          connectionCount: sysmlRes.connections.length,
          parts: sysmlRes.parts,
          connections: sysmlRes.connections,
          requirements: sysmlRes.requirements,
          states: sysmlRes.states,
        };
        break;
      }

      case "ssp": {
        const sspRes = buildSspArchitectureFromSource(content, baseTitle);
        if (sspRes.svg) {
          result.svg = sspRes.svg;
        }
        result.metadata = {
          nodeCount: sspRes.fmuComponents.length,
          connectionCount: sspRes.connections.length,
          dialect: "ssp",
          systemName: sspRes.systemName,
          sspVersion: sspRes.sspVersion,
        };
        result.viewConfigAdditions = {
          code: inlineCode,
          title: baseTitle,
          dialect: "ssp",
          systemName: sspRes.systemName,
          sspVersion: sspRes.sspVersion,
          fmiVersion: sspRes.fmiVersion,
          masterAlgorithm: sspRes.masterAlgorithm,
          communicationStepMs: sspRes.communicationStepMs,
          startTime: sspRes.startTime,
          stopTime: sspRes.stopTime,
          nodeCount: sspRes.fmuComponents.length,
          connectionCount: sspRes.connections.length,
          fmuComponents: sspRes.fmuComponents,
          connections: sspRes.connections,
          parameterSets: sspRes.parameterSets,
        };
        break;
      }

      case "modelscript": {
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const dslLang = viewType;
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

export interface SysmlConstraintWitness {
  expr: string;
  actual: string;
  bound: string;
  margin: string;
  passed: boolean;
}

export interface PreprocessedSysmlRequirement {
  id: string;
  name: string;
  text: string;
  status: "verified" | "satisfied" | "unverified" | "violated";
  subject?: string | undefined;
  satisfiedBy?: string | undefined;
  constraintExpr?: string | undefined;
  witnesses?: SysmlConstraintWitness[] | undefined;
}

export interface PreprocessedSysmlPart {
  name: string;
  type: string;
  multiplicity: string;
  ports: string[];
  attributes: string[];
  description?: string | undefined;
}

export interface PreprocessedSysmlConnection {
  source: string;
  target: string;
  flowType?: string | undefined;
}

export interface PreprocessedSysmlStateMachine {
  name: string;
  states: string[];
  transitions: { from: string; to: string; guard?: string | undefined }[];
}

export function buildSysmlArchitectureFromSource(content: string, fallbackTitle: string) {
  const pkgMatch = content.match(/\bpackage\s+([A-Za-z_]\w*)/);
  const packageName = pkgMatch?.[1] || fallbackTitle;

  // 1. Collect all numeric attribute values across the model for constraint evaluation
  const attrValues = new Map<string, { value: number; unit?: string | undefined }>();
  const attrValRe =
    /\battribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = attrValRe.exec(content)) !== null) {
    const attrName = m[1]!;
    const attrType = m[2] || "";
    const num = Number(m[3]);
    if (Number.isFinite(num)) {
      let unit = "";
      if (/Velocity|Mps/i.test(attrType) || /Mps$/i.test(attrName)) unit = "m/s";
      else if (/Thrust|Kn/i.test(attrType)) unit = "kN";
      else if (/Angle|Deg/i.test(attrType) || /Deg$/i.test(attrName)) unit = "deg";
      else if (/TimeMs|Ms$/i.test(attrType) || /Ms$/i.test(attrName)) unit = "ms";
      else if (/Sec$/i.test(attrName)) unit = "s";
      else if (/Pct|Percentage/i.test(attrType) || /Pct$/i.test(attrName)) unit = "%";
      else if (/Meters$/i.test(attrName)) unit = "m";
      else if (/Cm$/i.test(attrName)) unit = "cm";
      attrValues.set(attrName, { value: num, ...(unit ? { unit } : {}) });
    }
  }

  // 2. Parse port definitions
  const portDefs = new Map<string, string[]>();
  const portDefRe = /\bport\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = portDefRe.exec(content)) !== null) {
    const pName = m[1]!;
    const pBody = m[2] || "";
    const items: string[] = [];
    const attrRe = /\b(?:(in|out|inout)\s+)?attribute\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(pBody)) !== null) {
      const dir = am[1] ? `${am[1]} ` : "";
      items.push(`${dir}${am[2]}${am[3] ? ` : ${am[3]}` : ""}`);
    }
    portDefs.set(pName, items);
  }

  // 3. Parse part definitions (ports, attributes, doc, internal part usages)
  interface PartDefMeta {
    name: string;
    doc?: string | undefined;
    ports: { name: string; type: string; conjugated: boolean; dir: "in" | "out" | "inout" }[];
    attributes: string[];
    hasPartUsages: boolean;
  }
  const partDefs = new Map<string, PartDefMeta>();
  const partDefRe = /\bpart\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let rootPartDef = "";
  while ((m = partDefRe.exec(content)) !== null) {
    const defName = m[1]!;
    const body = m[2] || "";
    const docMatch = body.match(/\bdoc\s*\/\*([\s\S]*?)\*\//);
    const doc = docMatch?.[1]?.replace(/\s+/g, " ").trim();

    const ports: PartDefMeta["ports"] = [];
    const portRe = /\b(?:(in|out|inout)\s+)?port\s+([A-Za-z_]\w*)\s*:\s*(~?)([A-Za-z_]\w*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = portRe.exec(body)) !== null) {
      const explicitDir = pm[1] as "in" | "out" | "inout" | undefined;
      const portName = pm[2]!;
      const conjugated = pm[3] === "~";
      const portType = pm[4]!;
      const inferredDir: "in" | "out" | "inout" = explicitDir || (conjugated || /In$/i.test(portName) ? "in" : "out");
      ports.push({ name: portName, type: portType, conjugated, dir: inferredDir });
    }

    const attributes: string[] = [];
    const attrRe = /\battribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?(?:\s*=\s*([^;\n]+))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(body)) !== null) {
      const aName = am[1]!;
      const aType = am[2];
      const aVal = am[3]?.trim();
      const info = attrValues.get(aName);
      const unitSuffix = info?.unit && aVal && !aVal.includes(info.unit) ? ` ${info.unit}` : "";
      if (aVal) {
        attributes.push(`${aName} = ${aVal}${unitSuffix}`);
      } else if (aType) {
        attributes.push(`${aName} : ${aType}`);
      } else {
        attributes.push(aName);
      }
    }

    const hasPartUsages = /\bpart\s+(?!def\b)[A-Za-z_]\w*\s*:/.test(body);
    if (hasPartUsages) {
      rootPartDef = defName;
    }

    partDefs.set(defName, { name: defName, doc, ports, attributes, hasPartUsages });
  }

  // 4. Extract instantiated part usages
  const parts: PreprocessedSysmlPart[] = [];
  const portTypeLookup = new Map<string, string>();
  const partUsageRe = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)(?:\s*\[([^\]]+)\])?/g;
  while ((m = partUsageRe.exec(content)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const mult = m[3]?.trim() || "1";
    const defMeta = partDefs.get(type);
    const formattedPorts = (defMeta?.ports || []).map(
      (p) => `${p.dir} ${p.name} : ${p.conjugated ? "~" : ""}${p.type}`,
    );
    for (const p of defMeta?.ports || []) {
      portTypeLookup.set(`${name}.${p.name}`, p.type);
    }
    parts.push({
      name,
      type,
      multiplicity: mult,
      ports: formattedPorts,
      attributes: defMeta?.attributes || [],
      description: defMeta?.doc,
    });
  }

  if (parts.length === 0) {
    for (const defMeta of partDefs.values()) {
      if (defMeta.hasPartUsages && partDefs.size > 1) continue;
      parts.push({
        name: defMeta.name,
        type: "PartDefinition",
        multiplicity: "1",
        ports: defMeta.ports.map((p) => `${p.dir} ${p.name} : ${p.conjugated ? "~" : ""}${p.type}`),
        attributes: defMeta.attributes,
        description: defMeta.doc,
      });
    }
  }

  // 5. Extract connections
  const connections: PreprocessedSysmlConnection[] = [];
  const connRe = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRe.exec(content)) !== null) {
    const source = m[1]!;
    const target = m[2]!;
    const flowType = portTypeLookup.get(source) || portTypeLookup.get(target);
    connections.push({ source, target, ...(flowType ? { flowType } : {}) });
  }

  // 6. Extract state machines
  const states: PreprocessedSysmlStateMachine[] = [];
  const stateDefRe = /\bstate\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  while ((m = stateDefRe.exec(content)) !== null) {
    const smName = m[1]!;
    const smBody = m[2] || "";
    const stateNames: string[] = [];
    const stRe = /\bstate\s+(?!def\b)([A-Za-z_]\w*)\s*;/g;
    let smMatch: RegExpExecArray | null;
    while ((smMatch = stRe.exec(smBody)) !== null) {
      stateNames.push(smMatch[1]!);
    }
    const transitions: PreprocessedSysmlStateMachine["transitions"] = [];
    const trRe =
      /\btransition\s+(?:[A-Za-z_]\w*\s+)?first\s+([A-Za-z_]\w*)(?:\s+if\s+([\s\S]*?))?\s+then\s+([A-Za-z_]\w*)\s*;/g;
    while ((smMatch = trRe.exec(smBody)) !== null) {
      transitions.push({
        from: smMatch[1]!,
        to: smMatch[3]!,
        ...(smMatch[2] ? { guard: smMatch[2].replace(/\s+/g, " ").trim() } : {}),
      });
    }
    if (stateNames.length > 0) {
      states.push({ name: smName, states: stateNames, transitions });
    }
  }

  // 7. Extract satisfy / verify relationships and formal requirements
  const satisfyByMap = new Map<string, string>();
  const satisfyRe = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = satisfyRe.exec(content)) !== null) {
    satisfyByMap.set(m[1]!, m[2] || "System");
  }
  const verifyByMap = new Map<string, string>();
  const verifyRe = /\bverify\s+(?:requirement\s+)?([A-Za-z_]\w*)(?:\s+by\s+([A-Za-z0-9_.]+))?/g;
  while ((m = verifyRe.exec(content)) !== null) {
    verifyByMap.set(m[1]!, m[2] || "VerificationCase");
  }

  // Brace-balanced scan for requirement def blocks (since require constraint { ... } has nested braces)
  const requirements: PreprocessedSysmlRequirement[] = [];
  const reqHeaderRe = /\brequirement\s+(?:def\s+)?(?:<'([^']+)'>\s*)?([A-Za-z_]\w*)\s*\{/g;
  let reqIdx = 1;
  while ((m = reqHeaderRe.exec(content)) !== null) {
    const explicitId = m[1];
    const reqName = m[2]!;
    const openBraceIdx = m.index + m[0].length - 1;
    let depth = 1;
    let pos = openBraceIdx + 1;
    while (pos < content.length && depth > 0) {
      if (content[pos] === "{") depth++;
      else if (content[pos] === "}") depth--;
      pos++;
    }
    const body = content.slice(openBraceIdx + 1, pos - 1);
    const docMatch = body.match(/\bdoc\s*\/\*([\s\S]*?)\*\//) || body.match(/\/\*([\s\S]*?)\*\//);
    const text = docMatch ? docMatch[1]!.replace(/\s+/g, " ").trim() : `Requirement specification for ${reqName}`;

    const subjMatch = body.match(/\bsubject\s+([A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*)/);
    const subject = subjMatch?.[1]?.replace(/\s+/g, " ").trim();

    const constraintMatch = body.match(/\b(?:require|assume)\s+constraint\s*\{([\s\S]*?)\}/);
    const constraintExpr = constraintMatch?.[1]?.replace(/\s+/g, " ").trim();

    const witnesses: SysmlConstraintWitness[] = [];
    if (constraintExpr) {
      const clauses = constraintExpr
        .split(/\band\b|&&/i)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const clause of clauses) {
        const relMatch = clause.match(/^([A-Za-z0-9_.]+)\s*(<=|>=|==|<|>)\s*([-+]?\d+(?:\.\d+)?)$/);
        if (relMatch) {
          const lhs = relMatch[1]!;
          const op = relMatch[2]!;
          const rhsNum = Number(relMatch[3]);
          const shortVar = lhs.split(".").pop()!;
          const found = attrValues.get(shortVar);
          if (found !== undefined) {
            const actualVal = found.value;
            const unitStr = found.unit ? ` ${found.unit}` : "";
            let passed = true;
            if (op === "<=") passed = actualVal <= rhsNum + 1e-9;
            else if (op === "<") passed = actualVal < rhsNum - 1e-9;
            else if (op === ">=") passed = actualVal >= rhsNum - 1e-9;
            else if (op === ">") passed = actualVal > rhsNum + 1e-9;
            else if (op === "==") passed = Math.abs(actualVal - rhsNum) <= 1e-9;

            let margin = "exact";
            if (Math.abs(rhsNum) > 1e-9) {
              const diff = op.startsWith("<") ? rhsNum - actualVal : actualVal - rhsNum;
              const pct = (diff / Math.abs(rhsNum)) * 100;
              margin = Math.abs(pct) < 1e-4 ? "exact" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
            } else if (Math.abs(actualVal - rhsNum) > 1e-9) {
              const diff = op.startsWith("<") ? rhsNum - actualVal : actualVal - rhsNum;
              margin = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}${unitStr}`;
            }

            witnesses.push({
              expr: `${shortVar} ${op} ${rhsNum}`,
              actual: `${actualVal}${unitStr}`,
              bound: `${rhsNum}${unitStr}`,
              margin,
              passed,
            });
          } else {
            witnesses.push({
              expr: clause,
              actual: "symbolic",
              bound: String(rhsNum),
              margin: "symbolic",
              passed: true,
            });
          }
        }
      }
    }

    const satisfiedBy = satisfyByMap.get(reqName) || verifyByMap.get(reqName);
    let status: PreprocessedSysmlRequirement["status"] = "unverified";
    if (witnesses.length > 0) {
      status = witnesses.every((w) => w.passed) ? "verified" : "violated";
    } else if (constraintExpr) {
      status = "verified";
    } else if (satisfiedBy) {
      status = "satisfied";
    }

    requirements.push({
      id: explicitId || `REQ-${String(reqIdx).padStart(2, "0")}`,
      name: reqName,
      text,
      status,
      ...(subject ? { subject } : {}),
      ...(satisfiedBy ? { satisfiedBy } : {}),
      ...(constraintExpr ? { constraintExpr } : {}),
      ...(witnesses.length > 0 ? { witnesses } : {}),
    });
    reqIdx++;
  }

  // 8. Render crisp SysML v2 IBD + State Machine + Requirement Verification SVG
  const width = 940;
  const hasStateMachine = states.length > 0;
  const hasReqs = requirements.length > 0;
  const height = 270 + (hasStateMachine ? 92 : 0) + (hasReqs ? 118 : 0);

  const partBoxes = parts.slice(0, 4);
  const nParts = Math.max(1, partBoxes.length);
  const totalInnerW = width - 80;
  const boxW = Math.min(248, Math.floor((totalInnerW - (nParts - 1) * 58) / nParts));
  const boxH = 126;
  const startX = Math.floor((width - (nParts * boxW + (nParts - 1) * 58)) / 2);
  const partY = 78;

  const partPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const nodesSvg: string[] = [];

  partBoxes.forEach((p, idx) => {
    const x = startX + idx * (boxW + 58);
    const y = partY;
    partPos.set(p.name, { x, y, w: boxW, h: boxH });
    const multNum = parseInt(p.multiplicity, 10) || 1;

    const stackShadows =
      multNum > 1
        ? `<rect x="${x + 6}" y="${y - 6}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.38"/>
           <rect x="${x + 3}" y="${y - 3}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a" stroke="#3b82f6" stroke-width="1.2" opacity="0.68"/>`
        : "";

    const attrLines = p.attributes.slice(0, 2).map((attr, aIdx) => {
      const text = attr.length > 36 ? `${attr.slice(0, 35)}…` : attr;
      return `<text x="${x + 12}" y="${y + 68 + aIdx * 14}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5">${escapeXml(text)}</text>`;
    });

    const portPins: string[] = [];
    p.ports.forEach((rawPort, pIdx) => {
      const isIn = /^in\b/.test(rawPort) || rawPort.includes("~");
      const isConj = rawPort.includes("~");
      const cleanPort = rawPort.replace(/^(?:in|out|inout)\s+/, "");
      const portText = cleanPort.length > 38 ? `${cleanPort.slice(0, 37)}…` : cleanPort;
      const pinX = isIn ? x - 5 : x + boxW - 5;
      const pinY = y + 36 + pIdx * 28;
      const pinFill = isConj ? "#3b82f6" : "#0f172a";
      portPins.push(
        `<rect x="${pinX}" y="${pinY - 5}" width="10" height="10" rx="2" fill="${pinFill}" stroke="#60a5fa" stroke-width="1.5"/>`,
        `<text x="${x + 12}" y="${y + 102 + pIdx * 13}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9">${escapeXml(portText)}</text>`,
      );
    });

    nodesSvg.push(`<g>
      ${stackShadows}
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="#161f33" stroke="#3b82f6" stroke-width="1.6"/>
      <path d="M ${x} ${y + 6} A 6 6 0 0 1 ${x + 6} ${y} L ${x + boxW - 6} ${y} A 6 6 0 0 1 ${x + boxW} ${y + 6} L ${x + boxW} ${y + 42} L ${x} ${y + 42} Z" fill="rgba(59, 130, 246, 0.14)"/>
      <line x1="${x}" y1="${y + 42}" x2="${x + boxW}" y2="${y + 42}" stroke="#3b82f6" stroke-width="1"/>
      <text x="${x + boxW / 2}" y="${y + 15}" text-anchor="middle" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="600">«part» ${escapeXml(p.type)}</text>
      <text x="${x + boxW / 2}" y="${y + 33}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11.5" font-weight="700">${escapeXml(p.name)}${p.multiplicity !== "1" ? ` [${escapeXml(p.multiplicity)}]` : ""}</text>
      <text x="${x + 12}" y="${y + 54}" fill="#64748b" font-family="system-ui, sans-serif" font-size="8.5" font-weight="700" letter-spacing="0.05em">ATTRIBUTES &amp; PORTS</text>
      ${attrLines.join("\n      ")}
      ${portPins.join("\n      ")}
    </g>`);
  });

  // Render connections between parts
  const edgesSvg: string[] = [];
  connections.forEach((c) => {
    const srcPart = c.source.split(".")[0]!;
    const tgtPart = c.target.split(".")[0]!;
    const b1 = partPos.get(srcPart);
    const b2 = partPos.get(tgtPart);
    if (!b1 || !b2) return;
    const x1 = b1.x + b1.w + 5;
    const y1 = b1.y + 48;
    const x2 = b2.x - 5;
    const y2 = b2.y + 48;
    const midX = (x1 + x2) / 2;
    const flowLabel = c.flowType || `${c.source.split(".")[1] || "out"} → ${c.target.split(".")[1] || "in"}`;
    const badgeW = Math.max(84, flowLabel.length * 5.6 + 14);
    edgesSvg.push(`<g>
      <path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}" fill="none" stroke="#34d399" stroke-width="1.8" marker-end="url(#sysml-arrow)"/>
      <rect x="${midX - badgeW / 2}" y="${(y1 + y2) / 2 - 22}" width="${badgeW}" height="16" rx="4" fill="#0d1526" stroke="#10b981" stroke-width="1"/>
      <text x="${midX}" y="${(y1 + y2) / 2 - 11}" text-anchor="middle" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" font-weight="600">${escapeXml(flowLabel)}</text>
    </g>`);
  });

  // State machine strip if present
  let curBottomY = partY + boxH + 22;
  const smSvg: string[] = [];
  if (hasStateMachine) {
    const sm = states[0]!;
    const stList = sm.states.slice(0, 4);
    const bandX = 36;
    const bandW = width - 72;
    const bandH = 74;
    smSvg.push(
      `<rect x="${bandX}" y="${curBottomY}" width="${bandW}" height="${bandH}" rx="6" fill="rgba(168, 85, 247, 0.06)" stroke="rgba(168, 85, 247, 0.35)" stroke-width="1.2" stroke-dasharray="4 3"/>`,
      `<text x="${bandX + 14}" y="${curBottomY + 17}" fill="#c084fc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«state def» ${escapeXml(sm.name)} (Modal GNC Trajectory Schedule)</text>`,
    );
    const pillW = 166;
    const pillH = 30;
    const gap = 42;
    const stStartX = bandX + 24;
    const stY = curBottomY + 28;
    stList.forEach((stName, idx) => {
      const sx = stStartX + idx * (pillW + gap);
      smSvg.push(
        `<rect x="${sx}" y="${stY}" width="${pillW}" height="${pillH}" rx="15" fill="#1e1b38" stroke="#a855f7" stroke-width="1.4"/>`,
        `<text x="${sx + pillW / 2}" y="${stY + 19}" text-anchor="middle" fill="#f3e8ff" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10" font-weight="600">${escapeXml(stName)}</text>`,
      );
      if (idx < stList.length - 1) {
        const tr = sm.transitions.find((t) => t.from === stName && t.to === stList[idx + 1]);
        const ax1 = sx + pillW + 2;
        const ax2 = sx + pillW + gap - 4;
        const ay = stY + pillH / 2;
        smSvg.push(
          `<line x1="${ax1}" y1="${ay}" x2="${ax2}" y2="${ay}" stroke="#c084fc" stroke-width="1.4" marker-end="url(#sysml-arrow-purple)"/>`,
        );
        if (tr?.guard) {
          const shortGuard = tr.guard.replace("altitudeMeters", "alt");
          smSvg.push(
            `<text x="${(ax1 + ax2) / 2}" y="${ay - 6}" text-anchor="middle" fill="#d8b4fe" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">[${escapeXml(shortGuard)}]</text>`,
          );
        }
      }
    });
    curBottomY += bandH + 16;
  }

  // Requirements & formal constraint verification strip
  const reqSvg: string[] = [];
  if (hasReqs) {
    const reqList = requirements.slice(0, 3);
    const rCount = reqList.length;
    const rGap = 16;
    const rBoxW = Math.floor((width - 72 - (rCount - 1) * rGap) / rCount);
    const rBoxH = 96;
    reqList.forEach((r, idx) => {
      const rx = 36 + idx * (rBoxW + rGap);
      const ry = curBottomY;
      const isVerified = r.status === "verified";
      const isSatisfied = r.status === "satisfied" || isVerified;
      const strokeCol = isVerified ? "#10b981" : isSatisfied ? "#3b82f6" : "#f59e0b";
      const badgeFill = isVerified ? "rgba(16, 185, 129, 0.16)" : "rgba(245, 158, 11, 0.16)";
      const badgeTextCol = isVerified ? "#34d399" : "#fbbf24";
      const statusLabel = isVerified ? "✓ VERIFIED" : r.status === "satisfied" ? "SATISFIED" : "DOC ONLY";
      const rawConstraint = r.constraintExpr
        ? r.constraintExpr
            .replace(/<=/g, "≤")
            .replace(/>=/g, "≥")
            .replace(/\band\b/g, "∧")
        : r.text;
      const constraintLine = rawConstraint.length > 44 ? `${rawConstraint.slice(0, 43)}…` : rawConstraint;
      const rawWitness =
        r.witnesses && r.witnesses.length > 0
          ? r.witnesses.map((w) => `${w.actual} (${w.margin})`).join(" · ")
          : r.satisfiedBy
            ? `«satisfy» by ${r.satisfiedBy}`
            : "No formal constraint expression";
      const witnessLine = rawWitness.length > 44 ? `${rawWitness.slice(0, 43)}…` : rawWitness;

      reqSvg.push(`<g>
        <rect x="${rx}" y="${ry}" width="${rBoxW}" height="${rBoxH}" rx="6" fill="#111927" stroke="${strokeCol}" stroke-width="1.3"/>
        <text x="${rx + 10}" y="${ry + 18}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="700">«requirement» ${escapeXml(r.id)}</text>
        <rect x="${rx + rBoxW - 76}" y="${ry + 6}" width="68" height="16" rx="8" fill="${badgeFill}" stroke="${strokeCol}" stroke-width="0.8"/>
        <text x="${rx + rBoxW - 42}" y="${ry + 17}" text-anchor="middle" fill="${badgeTextCol}" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8" font-weight="700">${statusLabel}</text>
        <text x="${rx + 10}" y="${ry + 36}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" font-weight="700">${escapeXml(r.name.slice(0, 32))}</text>
        <text x="${rx + 10}" y="${ry + 55}" fill="#6ee7b7" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(constraintLine)}</text>
        <text x="${rx + 10}" y="${ry + 72}" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5">${escapeXml(witnessLine)}</text>
        ${r.satisfiedBy ? `<text x="${rx + 10}" y="${ry + 87}" fill="#60a5fa" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8">«satisfy» by ${escapeXml(r.satisfiedBy)}</text>` : ""}
      </g>`);
    });
  }

  const headerTitle = `ibd [part def] ${rootPartDef || packageName} [${packageName}]`;
  const tabW = Math.min(440, headerTitle.length * 7.2 + 28);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: #0b111e;">
  <defs>
    <marker id="sysml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#34d399"/>
    </marker>
    <marker id="sysml-arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0b111e"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="6" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <polygon points="14,14 ${14 + tabW},14 ${14 + tabW},32 ${14 + tabW - 12},42 14,42" fill="#161f33" stroke="#334155" stroke-width="1.2"/>
  <text x="26" y="32" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="700">${escapeXml(headerTitle)}</text>
  ${edgesSvg.join("\n  ")}
  ${nodesSvg.join("\n  ")}
  ${smSvg.join("\n  ")}
  ${reqSvg.join("\n  ")}
</svg>`;

  return {
    svg,
    packageName,
    rootPartDef: rootPartDef || packageName,
    parts,
    connections,
    requirements,
    states,
  };
}

function buildSspArchitectureFromSource(content: string, fallbackTitle: string) {
  const escapeXml = (s: string) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const getAttr = (tag: string, name: string): string | undefined => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
    return m ? m[1] : undefined;
  };

  const ssdMatch = /<(?:ssd:)?SystemStructureDescription\b([^>]*)>/i.exec(content);
  const sspVersion = (ssdMatch && getAttr(ssdMatch[1]!, "version")) || "1.0";
  const sysMatch = /<(?:ssd:)?System\b([^>]*)>/i.exec(content);
  const systemName =
    (sysMatch && getAttr(sysMatch[1]!, "name")) ||
    (ssdMatch && getAttr(ssdMatch[1]!, "name")) ||
    fallbackTitle ||
    "System";

  const expMatch = /<(?:ssd:)?DefaultExperiment\b([^>]*)\/?>/i.exec(content);
  const startTime = expMatch && getAttr(expMatch[1]!, "startTime") ? Number(getAttr(expMatch[1]!, "startTime")) : 0.0;
  const stopTime = expMatch && getAttr(expMatch[1]!, "stopTime") ? Number(getAttr(expMatch[1]!, "stopTime")) : 600.0;
  const stepSize = expMatch && getAttr(expMatch[1]!, "stepSize") ? Number(getAttr(expMatch[1]!, "stepSize")) : 0.002;
  const communicationStepMs = Number((stepSize * 1000).toFixed(2));
  const masterAlgorithm = (expMatch && getAttr(expMatch[1]!, "algorithm")) || "Fixed-Step Gauss-Seidel";

  // Extract inline SSV parameter bindings per component
  const paramsByComp = new Map<string, { name: string; value: string; unit?: string | undefined }[]>();
  const parameterSets: string[] = [];
  const bindingRe = /<(?:ssd:)?ParameterBinding\b([^>]*)>([\s\S]*?)<\/(?:ssd:)?ParameterBinding>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = bindingRe.exec(content)) !== null) {
    const prefix = (getAttr(bm[1]!, "prefix") || "").replace(/\.$/, "");
    const body = bm[2]!;
    const setMatch = /<(?:ssv:)?ParameterSet\b([^>]*)>/i.exec(body);
    if (setMatch) {
      const setName = getAttr(setMatch[1]!, "name");
      if (setName) parameterSets.push(setName.endsWith(".ssv") ? setName : `${setName}.ssv`);
    }
    const pRe = /<(?:ssv:)?Parameter\b([^>]*)>([\s\S]*?)<\/(?:ssv:)?Parameter>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(body)) !== null) {
      const pName = getAttr(pm[1]!, "name") || "param";
      const valMatch = /<(?:ssv:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(pm[2]!);
      if (valMatch) {
        const val = getAttr(valMatch[2]!, "value") ?? "";
        const unit = getAttr(valMatch[2]!, "unit");
        if (!paramsByComp.has(prefix)) paramsByComp.set(prefix, []);
        paramsByComp.get(prefix)!.push({ name: pName, value: val, unit });
      }
    }
  }

  interface SspPortInfo {
    name: string;
    kind: "input" | "output" | "inout" | "parameter";
    type: string;
    unit?: string | undefined;
  }

  interface SspFmuInfo {
    name: string;
    source: string;
    mimeType: string;
    fmiType: string;
    inputs: string[];
    outputs: string[];
    ports: SspPortInfo[];
    parameters: { name: string; value: string; unit?: string | undefined }[];
    geom?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  }

  const fmuComponents: SspFmuInfo[] = [];
  const compRe = /<(?:ssd:)?Component\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Component>)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = compRe.exec(content)) !== null) {
    const attrs = cm[1]!;
    const body = cm[2] || "";
    const name = getAttr(attrs, "name") || `FMU_${fmuComponents.length + 1}`;
    const source = getAttr(attrs, "source") || `resources/${name}.fmu`;
    const mimeType = getAttr(attrs, "type") || "application/x-fmu-sharedlibrary";
    const geomMatch = /<(?:ssd:)?ElementGeometry\b([^>]*)\/?>/i.exec(body);
    const geom = geomMatch
      ? {
          x1: Number(getAttr(geomMatch[1]!, "x1") ?? 0),
          y1: Number(getAttr(geomMatch[1]!, "y1") ?? 0),
          x2: Number(getAttr(geomMatch[1]!, "x2") ?? 220),
          y2: Number(getAttr(geomMatch[1]!, "y2") ?? 140),
        }
      : undefined;

    const ports: SspPortInfo[] = [];
    const connRe = /<(?:ssd:)?Connector\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connector>)/gi;
    let connM: RegExpExecArray | null;
    while ((connM = connRe.exec(body)) !== null) {
      const cAttrs = connM[1]!;
      const cBody = connM[2] || "";
      const cName = getAttr(cAttrs, "name") || "port";
      const rawKind = (getAttr(cAttrs, "kind") || "inout").toLowerCase();
      const kind: SspPortInfo["kind"] =
        rawKind === "input" || rawKind === "output" || rawKind === "parameter" ? rawKind : "inout";
      const typeMatch = /<(?:ssc:)?(Real|Integer|Boolean|String|Enumeration)\b([^>]*)\/?>/i.exec(cBody);
      const type = typeMatch ? typeMatch[1]! : "Real";
      let unit = typeMatch ? getAttr(typeMatch[2]!, "unit") : undefined;
      if (!unit) {
        if (cName.endsWith("_W")) unit = "W";
        else if (cName.endsWith("_K")) unit = "K";
      }
      ports.push({ name: cName, kind, type, unit });
    }

    const inputs = ports.filter((p) => p.kind === "input").map((p) => p.name);
    const outputs = ports.filter((p) => p.kind === "output" || p.kind === "inout").map((p) => p.name);
    const parameters = paramsByComp.get(name) ?? [];

    fmuComponents.push({
      name,
      source,
      mimeType,
      fmiType: "FMI 3.0 CS",
      inputs,
      outputs,
      ports,
      parameters,
      geom,
    });
  }

  interface SspConnInfo {
    startElement: string;
    startConnector: string;
    endElement: string;
    endConnector: string;
    type: string;
    unit?: string | undefined;
  }

  const connections: SspConnInfo[] = [];
  const edgeRe = /<(?:ssd:)?Connection\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ssd:)?Connection>)/gi;
  let em: RegExpExecArray | null;
  while ((em = edgeRe.exec(content)) !== null) {
    const attrs = em[1]!;
    const startElement = getAttr(attrs, "startElement") || "";
    const startConnector = getAttr(attrs, "startConnector") || "";
    const endElement = getAttr(attrs, "endElement") || "";
    const endConnector = getAttr(attrs, "endConnector") || "";
    const srcComp = fmuComponents.find((c) => c.name === startElement);
    const srcPort = srcComp?.ports.find((p) => p.name === startConnector);
    const tgtComp = fmuComponents.find((c) => c.name === endElement);
    const tgtPort = tgtComp?.ports.find((p) => p.name === endConnector);
    const type = srcPort?.type || tgtPort?.type || "Real";
    const unit =
      srcPort?.unit ||
      tgtPort?.unit ||
      (startConnector.endsWith("_W") ? "W" : startConnector.endsWith("_K") ? "K" : undefined);
    connections.push({
      startElement,
      startConnector,
      endElement,
      endConnector,
      type,
      unit,
    });
  }

  // Build SSP 1.0 System Structure Schematic SVG (980 x 540)
  const W = 980;
  const H = 540;
  const resolveColor = (type: string, unit?: string) => {
    if (type === "Boolean") return { stroke: "#ec4899", marker: "ssp-arr-pink" };
    if (type === "Integer") return { stroke: "#f97316", marker: "ssp-arr-orange" };
    if (unit === "W" || unit === "kW") return { stroke: "#f59e0b", marker: "ssp-arr-amber" };
    return { stroke: "#38bdf8", marker: "ssp-arr-cyan" };
  };

  const defaultBoxes =
    fmuComponents.length === 4
      ? [
          { x: 76, y: 72, w: 242, h: 160 },
          { x: 76, y: 268, w: 242, h: 150 },
          { x: 398, y: 146, w: 258, h: 192 },
          { x: 726, y: 146, w: 218, h: 170 },
        ]
      : fmuComponents.map((_, idx) => {
          const cols = Math.min(3, Math.max(1, fmuComponents.length));
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          return { x: 76 + col * 296, y: 80 + row * 184, w: 242, h: 156 };
        });

  interface PlacedFmu {
    comp: SspFmuInfo;
    x: number;
    y: number;
    w: number;
    h: number;
    inPorts: Map<string, { x: number; y: number; port: SspPortInfo }>;
    outPorts: Map<string, { x: number; y: number; port: SspPortInfo }>;
  }

  const placed = new Map<string, PlacedFmu>();
  fmuComponents.forEach((comp, idx) => {
    const fb = defaultBoxes[idx] ?? { x: 76, y: 80, w: 240, h: 156 };
    const hasCanvasGeom =
      comp.geom &&
      Math.min(comp.geom.x1, comp.geom.x2) >= 30 &&
      Math.max(comp.geom.x1, comp.geom.x2) <= 955 &&
      Math.abs(comp.geom.x2 - comp.geom.x1) >= 160;
    const x = hasCanvasGeom ? Math.round(Math.min(comp.geom!.x1, comp.geom!.x2)) : fb.x;
    const y = hasCanvasGeom ? Math.round(Math.min(comp.geom!.y1, comp.geom!.y2)) : fb.y;
    const w = hasCanvasGeom ? Math.round(Math.abs(comp.geom!.x2 - comp.geom!.x1)) : fb.w;
    const h = hasCanvasGeom ? Math.round(Math.abs(comp.geom!.y2 - comp.geom!.y1)) : fb.h;

    const headerH = 44;
    const paramH = comp.parameters.length > 0 ? 44 : 26;
    const portZoneTop = y + headerH;
    const portZoneH = Math.max(48, h - headerH - paramH);

    const inList = comp.ports.filter((p) => p.kind === "input");
    const outList = comp.ports.filter((p) => p.kind === "output" || p.kind === "inout");

    const inPorts = new Map<string, { x: number; y: number; port: SspPortInfo }>();
    inList.forEach((p, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (inList.length + 1));
      inPorts.set(p.name, { x, y: py, port: p });
    });

    const outPorts = new Map<string, { x: number; y: number; port: SspPortInfo }>();
    outList.forEach((p, i) => {
      const py = Math.round(portZoneTop + ((i + 1) * portZoneH) / (outList.length + 1));
      outPorts.set(p.name, { x: x + w, y: py, port: p });
    });

    placed.set(comp.name, { comp, x, y, w, h, inPorts, outPorts });
  });

  const roundedOrthoPath = (pts: { x: number; y: number }[], r = 7): string => {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
    const d: string[] = [`M ${pts[0]!.x} ${pts[0]!.y}`];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const l1 = Math.hypot(dx1, dy1);
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const l2 = Math.hypot(dx2, dy2);
      const cr = Math.min(r, l1 / 2.2, l2 / 2.2);
      if (cr < 1.5) {
        d.push(`L ${curr.x} ${curr.y}`);
      } else {
        const p1x = Math.round((curr.x - (dx1 / l1) * cr) * 10) / 10;
        const p1y = Math.round((curr.y - (dy1 / l1) * cr) * 10) / 10;
        const p2x = Math.round((curr.x + (dx2 / l2) * cr) * 10) / 10;
        const p2y = Math.round((curr.y + (dy2 / l2) * cr) * 10) / 10;
        d.push(`L ${p1x} ${p1y} Q ${curr.x} ${curr.y} ${p2x} ${p2y}`);
      }
    }
    const last = pts[pts.length - 1]!;
    d.push(`L ${last.x} ${last.y}`);
    return d.join(" ");
  };

  const startCounts = new Map<string, number>();
  for (const c of connections) {
    const k = `${c.startElement}.${c.startConnector}`;
    startCounts.set(k, (startCounts.get(k) ?? 0) + 1);
  }

  const connPaths: string[] = [];
  const connLabels: string[] = [];
  const junctions = new Map<string, { x: number; y: number; color: string }>();
  const renderedFeedbackBus = new Set<string>();
  let fwdIdx = 0;

  for (const conn of connections) {
    const srcNode = placed.get(conn.startElement);
    const tgtNode = placed.get(conn.endElement);
    const srcPort = srcNode?.outPorts.get(conn.startConnector);
    const tgtPort = tgtNode?.inPorts.get(conn.endConnector);
    if (!srcNode || !tgtNode || !srcPort || !tgtPort) continue;

    const style = resolveColor(conn.type, conn.unit);
    const startKey = `${conn.startElement}.${conn.startConnector}`;
    let pts: { x: number; y: number }[] = [];
    let lx = 0;
    let ly = 0;
    let showLabel = true;

    if (tgtPort.x > srcPort.x + 20) {
      if (Math.abs(srcPort.y - tgtPort.y) <= 4) {
        pts = [
          { x: srcPort.x, y: srcPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
        lx = Math.round((srcPort.x + tgtPort.x) / 2);
        ly = srcPort.y - 13;
      } else {
        const midX = Math.round((srcPort.x + tgtPort.x) / 2) + ((fwdIdx++ % 2) * 8 - 4);
        pts = [
          { x: srcPort.x, y: srcPort.y },
          { x: midX, y: srcPort.y },
          { x: midX, y: tgtPort.y },
          { x: tgtPort.x, y: tgtPort.y },
        ];
        lx = midX;
        ly = Math.round((srcPort.y + tgtPort.y) / 2);
      }
    } else {
      const rightX = srcPort.x + 30;
      const busY = 448;
      const leftX = Math.max(38, tgtPort.x - 34);
      pts = [
        { x: srcPort.x, y: srcPort.y },
        { x: rightX, y: srcPort.y },
        { x: rightX, y: busY },
        { x: leftX, y: busY },
        { x: leftX, y: tgtPort.y },
        { x: tgtPort.x, y: tgtPort.y },
      ];
      lx = Math.round((rightX + leftX) / 2);
      ly = busY - 12;
      if (renderedFeedbackBus.has(startKey)) {
        showLabel = false;
        junctions.set(`${startKey}@${leftX},${tgtPort.y}`, {
          x: leftX,
          y: tgtPort.y,
          color: style.stroke,
        });
      } else {
        renderedFeedbackBus.add(startKey);
      }
    }

    const d = roundedOrthoPath(pts, 7);
    connPaths.push(
      `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="5" stroke-opacity="0.14" stroke-linecap="round" stroke-linejoin="round" />`,
      `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${style.marker})" />`,
    );

    if (showLabel) {
      const unitSuffix = conn.unit ? ` [${conn.unit}]` : "";
      const text = `${conn.startConnector}${unitSuffix}`;
      const pw = Math.max(72, Math.round(text.length * 5.9 + 14));
      connLabels.push(
        `<g transform="translate(${lx}, ${ly})">` +
          `<rect x="${-Math.round(pw / 2)}" y="-9" width="${pw}" height="17" rx="4" fill="#09101d" fill-opacity="0.93" stroke="${style.stroke}" stroke-width="1" stroke-opacity="0.55" />` +
          `<text x="0" y="3" text-anchor="middle" fill="#e2e8f0" font-size="9.2" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(text)}</text>` +
          `</g>`,
      );
    }
  }

  const junctionSvg: string[] = [];
  for (const j of junctions.values()) {
    junctionSvg.push(
      `<circle cx="${j.x}" cy="${j.y}" r="7" fill="${j.color}" fill-opacity="0.24" />`,
      `<circle cx="${j.x}" cy="${j.y}" r="4.2" fill="${j.color}" stroke="#0b111e" stroke-width="1.5" />`,
    );
  }

  const compNodesSvg: string[] = [];
  for (const p of placed.values()) {
    const { comp, x, y, w, h, inPorts, outPorts } = p;
    const shortFmu = comp.source.split("/").pop() || comp.source;
    const headerH = 44;
    const paramH = comp.parameters.length > 0 ? 44 : 26;
    const paramTop = y + h - paramH;

    const portSvg: string[] = [];
    for (const ip of inPorts.values()) {
      const st = resolveColor(ip.port.type, ip.port.unit);
      const uBadge = ip.port.unit ? ` [${ip.port.unit}]` : "";
      portSvg.push(
        `<g transform="translate(${ip.x}, ${ip.y})">` +
          `<polygon points="-6,-5.5 5,0 -6,5.5" fill="${st.stroke}" stroke="#0b111e" stroke-width="1.3" />` +
          `<text x="10" y="3.5" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(ip.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXml(uBadge)}</tspan></text>` +
          `</g>`,
      );
    }
    for (const op of outPorts.values()) {
      const st = resolveColor(op.port.type, op.port.unit);
      const uBadge = op.port.unit ? ` [${op.port.unit}]` : "";
      portSvg.push(
        `<g transform="translate(${op.x}, ${op.y})">` +
          `<polygon points="-4,-5.5 7,0 -4,5.5" fill="#0b111e" stroke="${st.stroke}" stroke-width="1.8" />` +
          `<text x="-9" y="3.5" text-anchor="end" fill="#cbd5e1" font-size="9.8" font-weight="500" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(op.port.name)}<tspan fill="${st.stroke}" font-weight="700">${escapeXml(uBadge)}</tspan></text>` +
          `</g>`,
      );
    }

    const paramSummary =
      comp.parameters.length > 0
        ? comp.parameters.map((pr) => `${pr.name}=${pr.value}${pr.unit ? ` ${pr.unit}` : ""}`).join(" · ")
        : `mime: ${comp.mimeType}`;

    const fmuPillW = Math.min(w - 88, Math.round(shortFmu.length * 5.2 + 12));
    compNodesSvg.push(
      `<g class="ssp-fmu-node" data-fmu="${escapeXml(comp.name)}">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#111a2e" stroke="#10b981" stroke-width="1.8" filter="url(#ssp-shadow)" />` +
        `<path d="M ${x + 8} ${y} L ${x + w - 8} ${y} Q ${x + w} ${y} ${x + w} ${y + 8} L ${x + w} ${y + headerH} L ${x} ${y + headerH} L ${x} ${y + 8} Q ${x} ${y} ${x + 8} ${y} Z" fill="url(#ssp-fmu-hdr)" />` +
        `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="#10b981" stroke-opacity="0.45" stroke-width="1" />` +
        `<text x="${x + 10}" y="${y + 15}" fill="#34d399" font-size="8.8" font-weight="700" letter-spacing="0.4" font-family="'Inter', system-ui, sans-serif">«FMU 3.0 CS»</text>` +
        `<rect x="${x + w - fmuPillW - 8}" y="${y + 5}" width="${fmuPillW}" height="14" rx="3" fill="#064e3b" fill-opacity="0.75" stroke="#10b981" stroke-opacity="0.4" stroke-width="0.8" />` +
        `<text x="${x + w - 13}" y="${y + 14.5}" text-anchor="end" fill="#a7f3d0" font-size="8.2" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(shortFmu)}</text>` +
        `<text x="${x + 10}" y="${y + 34}" fill="#f8fafc" font-size="12.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">${escapeXml(comp.name)}</text>` +
        `<line x1="${x}" y1="${paramTop}" x2="${x + w}" y2="${paramTop}" stroke="#1e293b" stroke-width="1" />` +
        `<path d="M ${x} ${paramTop} L ${x + w} ${paramTop} L ${x + w} ${y + h - 8} Q ${x + w} ${y + h} ${x + w - 8} ${y + h} L ${x + 8} ${y + h} Q ${x} ${y + h} ${x} ${y + h - 8} Z" fill="#0b1324" fill-opacity="0.85" />` +
        `<text x="${x + 10}" y="${paramTop + 13}" fill="#64748b" font-size="7.8" font-weight="700" letter-spacing="0.5" font-family="'Inter', system-ui, sans-serif">SSV PARAMETERS</text>` +
        `<text x="${x + 10}" y="${paramTop + 27}" fill="#94a3b8" font-size="9" font-family="'JetBrains Mono', ui-monospace, monospace">${escapeXml(paramSummary)}</text>` +
        portSvg.join("") +
        `</g>`,
    );
  }

  const svg =
    fmuComponents.length > 0
      ? [
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%">`,
          `  <defs>`,
          `    <pattern id="ssp-grid" width="24" height="24" patternUnits="userSpaceOnUse">`,
          `      <circle cx="12" cy="12" r="0.9" fill="#1e293b" />`,
          `    </pattern>`,
          `    <linearGradient id="ssp-fmu-hdr" x1="0" y1="0" x2="1" y2="1">`,
          `      <stop offset="0%" stop-color="#064e3b" stop-opacity="0.72" />`,
          `      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92" />`,
          `    </linearGradient>`,
          `    <filter id="ssp-shadow" x="-6%" y="-6%" width="112%" height="116%">`,
          `      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#020617" flood-opacity="0.55" />`,
          `    </filter>`,
          `    <marker id="ssp-arr-amber" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
          `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f59e0b" />`,
          `    </marker>`,
          `    <marker id="ssp-arr-cyan" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
          `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#38bdf8" />`,
          `    </marker>`,
          `    <marker id="ssp-arr-pink" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
          `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#ec4899" />`,
          `    </marker>`,
          `    <marker id="ssp-arr-orange" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
          `      <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#f97316" />`,
          `    </marker>`,
          `  </defs>`,
          `  <rect width="${W}" height="${H}" rx="10" fill="#0b111e" />`,
          `  <rect width="${W}" height="${H}" rx="10" fill="url(#ssp-grid)" />`,
          `  <rect x="14" y="12" width="${W - 28}" height="${H - 24}" rx="9" fill="none" stroke="#1e293b" stroke-width="1.6" />`,
          `  <path d="M 14 12 L 464 12 L 464 32 L 450 44 L 14 44 Z" fill="#111c33" stroke="#1e293b" stroke-width="1.4" />`,
          `  <text x="26" y="32" fill="#e2e8f0" font-size="11.5" font-weight="700" font-family="'Inter', system-ui, sans-serif">`,
          `    <tspan fill="#10b981">ssd</tspan> <tspan fill="#94a3b8" font-weight="500">[System]</tspan> ${escapeXml(systemName)} <tspan fill="#64748b" font-size="10" font-weight="500">(SSP ${escapeXml(sspVersion)} · FMI 3.0 CS)</tspan>`,
          `  </text>`,
          `  <g transform="translate(530, 18)">`,
          `    <rect x="0" y="0" width="132" height="22" rx="5" fill="#111827" stroke="#f59e0b" stroke-opacity="0.45" stroke-width="1" />`,
          `    <line x1="10" y1="11" x2="26" y2="11" stroke="#f59e0b" stroke-width="2.2" />`,
          `    <polygon points="26,7.5 32,11 26,14.5" fill="#f59e0b" />`,
          `    <text x="38" y="14.5" fill="#fde68a" font-size="9.5" font-weight="600" font-family="'Inter', system-ui, sans-serif">Heat Flow [W]</text>`,
          `    <rect x="142" y="0" width="142" height="22" rx="5" fill="#111827" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="1" />`,
          `    <line x1="152" y1="11" x2="168" y2="11" stroke="#38bdf8" stroke-width="2.2" />`,
          `    <polygon points="168,7.5 174,11 168,14.5" fill="#38bdf8" />`,
          `    <text x="180" y="14.5" fill="#bae6fd" font-size="9.5" font-weight="600" font-family="'Inter', system-ui, sans-serif">Coolant Temp [K]</text>`,
          `    <rect x="294" y="0" width="130" height="22" rx="5" fill="#064e3b" fill-opacity="0.55" stroke="#10b981" stroke-opacity="0.5" stroke-width="1" />`,
          `    <text x="359" y="14.5" text-anchor="middle" fill="#a7f3d0" font-size="9.5" font-weight="700" font-family="'JetBrains Mono', ui-monospace, monospace">Δt = ${communicationStepMs.toFixed(1)} ms CS</text>`,
          `  </g>`,
          `  <g class="ssp-connections">`,
          ...connPaths.map((p) => `    ${p}`),
          ...junctionSvg.map((p) => `    ${p}`),
          `  </g>`,
          `  <g class="ssp-components">`,
          ...compNodesSvg.map((p) => `    ${p}`),
          `  </g>`,
          `  <g class="ssp-labels">`,
          ...connLabels.map((p) => `    ${p}`),
          `  </g>`,
          `  <g transform="translate(26, ${H - 44})">`,
          `    <rect x="0" y="0" width="${W - 52}" height="24" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1" />`,
          `    <circle cx="14" cy="12" r="3.5" fill="#10b981" />`,
          `    <text x="24" y="15.5" fill="#94a3b8" font-size="9.5" font-weight="600" font-family="'JetBrains Mono', ui-monospace, monospace">`,
          `      <tspan fill="#10b981" font-weight="700">MASTER:</tspan> ${escapeXml(masterAlgorithm)}  ·  <tspan fill="#cbd5e1">DefaultExperiment:</tspan> t = ${startTime.toFixed(1)}s → ${stopTime.toFixed(1)}s (Δt = ${communicationStepMs.toFixed(1)} ms)  ·  <tspan fill="#38bdf8">${fmuComponents.length} FMUs</tspan> · <tspan fill="#f59e0b">${connections.length} Causal Signals</tspan>`,
          `    </text>`,
          `  </g>`,
          `</svg>`,
        ].join("\n")
      : undefined;

  return {
    svg,
    systemName,
    sspVersion,
    fmiVersion: "3.0 Co-Simulation",
    masterAlgorithm,
    communicationStepMs,
    startTime,
    stopTime,
    fmuComponents,
    connections,
    parameterSets,
  };
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
