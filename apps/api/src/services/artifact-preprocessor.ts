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
          const cAny = comp as any;
          const t = comp.type?.toUpperCase() || "";
          if (t === "IN" || t === "INTEGRATOR" || t === "LAG" || t === "POLE") dynamicStates += 1;
          else if (t === "TF" || t === "SECOND_ORDER") dynamicStates += 2;
          if (cAny.inputs) inputCount += Object.keys(cAny.inputs).length;
          if (cAny.outputs) outputCount += Object.keys(cAny.outputs).length;
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
        const cylinders = (model.components || []).filter((c) => c.kind === "cylinder") as any[];
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
          lines: (model.lines || []).map((l: any, i: number) => {
            const rad = (2 * Math.PI * i) / Math.max(1, linesCount);
            const anchorR = l.length || (waterDepth ? waterDepth * 2 : 500);
            return {
              id: `line-${i + 1}`,
              name: l.name || `Line #${i + 1}`,
              anchorRadius: anchorR,
              azimuthDeg: (360 / Math.max(1, linesCount)) * i,
              tension: l.pretension || 0,
              mbl: l.mbl || 0,
              anchorPos: [
                Math.round(anchorR * Math.cos(rad)),
                Math.round(anchorR * Math.sin(rad)),
                -(waterDepth || 100),
              ] as [number, number, number],
            };
          }),
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
        const bodies = Array.from(model.bodies.values()).map((b: any) => ({
          name: b.name,
          mass: b.mass,
          inertia: [b.ixx ?? b.inertia?.[0] ?? 0, b.iyy ?? b.inertia?.[1] ?? 0, b.izz ?? b.inertia?.[2] ?? 0],
          cg: [b.x ?? b.cg?.[0] ?? 0, b.y ?? b.cg?.[1] ?? 0, b.z ?? b.cg?.[2] ?? 0],
        }));
        const couplings = Array.from(model.couplings.values()).map((c: any) => ({
          name: c.name,
          type: c.type,
          from: c.bodyFrom ?? c.from ?? "",
          to: c.bodyTo ?? c.to ?? "",
          stiffness: c.stiffnessOrDamping ?? c.stiffness ?? 0,
        }));
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
        const bodies = Array.from(model.bodies.values()).map((b: any) => ({
          name: b.name,
          mass: b.mass,
        }));
        const joints = Array.from(model.joints.values()).map((j: any) => ({
          name: j.name,
          type: j.type,
          from: j.bodyFrom ?? j.from ?? "",
          to: j.bodyTo ?? j.to ?? "",
        }));
        const forces = Array.from(model.forces.values()).map((f: any) => ({
          name: f.name,
          type: f.type,
          from: f.bodyFrom ?? f.from ?? "",
          to: f.bodyTo ?? f.to ?? "",
          parameters: f.parameters ?? {},
        }));
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
        const deck: any = parseSpice(content);
        const elements = deck.elements || deck.components || [];
        const subcircuits = deck.subcircuits
          ? Array.isArray(deck.subcircuits)
            ? deck.subcircuits
            : Array.from(deck.subcircuits.values())
          : [];
        result.svg = renderSpiceSvg({
          title: deck.title || baseTitle,
          elements,
          subcircuits,
        } as any);
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
        const simulinkMod: any = await import("@modelscript/simulink");
        const { renderSimulinkSvg } = await import("@modelscript/diagram/simulink-diagram-builder");
        const isXml = content.trimStart().startsWith("<");
        const parseXmlFn = simulinkMod.parseSimulinkXml || simulinkMod.parseSlxXml || simulinkMod.parseMdl;
        const model = isXml ? parseXmlFn(content, baseTitle) : simulinkMod.parseMdl(content, baseTitle);
        const rootSys = model.rootSystem || model;
        result.svg = renderSimulinkSvg(rootSys);
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
        const deck: any = parseInpDeck(content);
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
        const cfg: any = parseSu2Config(content);
        const svg = buildCfdDomainSvgFromConfig(cfg, baseTitle);
        result.svg = svg;
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
        const owlMod: any = await import("@modelscript/owl2");
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const ontology = owlMod.parseOWL2 ? owlMod.parseOWL2(content) : { axioms: [], iri: baseTitle };
        const diag = owlMod.buildOWL2DiagramData
          ? owlMod.buildOWL2DiagramData(ontology.axioms || [])
          : buildPolyglotDiagramFromSource(content, "owl2", baseTitle);
        result.svg = renderPolyglotDiagramToSvg(diag as any, { theme: "dark" });
        const classCount = (diag.nodes || []).filter((n: any) => n.kind === "class" || n.type === "class").length;
        const indivCount = (diag.nodes || []).filter(
          (n: any) => n.kind === "individual" || n.type === "individual",
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

      case "sysml":
      case "modelica-diagram":
      case "modelica-code":
      case "modelscript":
      case "ssp":
      case "scad":
      case "autosar":
      case "ccsds":
      case "energyplus":
      case "epanet":
      case "plcopen":
      case "reqif":
      case "verilog-a":
      case "c":
      case "fortran": {
        const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
        const dslLang =
          viewType === "modelica-diagram" || viewType === "modelica-code"
            ? "modelica"
            : viewType === "sysml"
              ? "sysml2"
              : viewType;
        const diag = buildPolyglotDiagramFromSource(content, dslLang, baseTitle);
        if (diag.nodes.length > 0) {
          result.svg = renderPolyglotDiagramToSvg(diag as any, { theme: "dark" });
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
        result.svg = renderSwmmSvg(model as any);
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
        const net: any = parseTouchstone(content);
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
            ? Array.from(firstComp.pins.values()).map((p: any) => ({ pin: p.pin, signal: p.signal, model: p.model }))
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
        result.svg = renderOpenDssSvg(deck as any);
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
          entities: Array.from(scen.entities.values()).map((e: any) => ({ name: e.name, category: e.category })),
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
        result.svg = renderRelap5Svg(deck as any);
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
        result.svg = renderEclipseSvg(deck as any);
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

  // Extract declarations across Modelica, SysML v2, SSP, OpenSCAD, C/Fortran, XML, etc.
  const declPatterns = [
    /\b(?:part|item|port|action|state|requirement|attribute|package|block|model|class|connector|record|function|module|subroutine|entity)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/g,
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

  if (nodes.length === 0 && content.trim().length > 0) {
    addNode(fallbackTitle || dslLang, dslLang, `${fallbackTitle || dslLang} (${dslLang})`);
  }

  return {
    nodes,
    edges,
    coordinateSystem: null,
    diagramBackground: null,
  };
}

function buildFeaMeshSvgFromDeck(deck: any, fallbackTitle: string): string {
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

function buildCfdDomainSvgFromConfig(cfg: any, fallbackTitle: string): string {
  const width = 680;
  const height = 360;
  const solver = escapeXml(cfg.solver || "EULER");
  const turb = escapeXml(cfg.kindTurbModel || "NONE");
  const mach = cfg.machNumber !== undefined ? Number(cfg.machNumber).toFixed(2) : "N/A";
  const aoa = cfg.aoa !== undefined ? `${Number(cfg.aoa).toFixed(1)}°` : "0.0°";
  const farMarkers = (cfg.markersFar || []).map(escapeXml).join(", ") || "farfield";
  const wallMarkers = [...(cfg.markersEuler || []), ...(cfg.markersHeatflux || [])].map(escapeXml).join(", ") || "wall";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="24" y="28" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">CFD DOMAIN // ${escapeXml(fallbackTitle)}</text>
    <text x="24" y="46" fill="#38bdf8" font-family="monospace" font-size="11">Solver: ${solver} | Turbulence: ${turb} | Mach: ${mach} | AoA: ${aoa}</text>
    <rect x="60" y="70" width="560" height="240" rx="12" fill="rgba(30, 41, 59, 0.45)" stroke="#38bdf8" stroke-dasharray="6 4" stroke-width="1.5"/>
    <text x="340" y="92" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="10">FARFIELD BOUNDARY [${farMarkers}]</text>
    <g stroke="#0ea5e9" stroke-width="1.5" opacity="0.65">
      <line x1="90" y1="140" x2="210" y2="140" />
      <line x1="90" y1="190" x2="210" y2="190" />
      <line x1="90" y1="240" x2="210" y2="240" />
    </g>
    <path d="M 240,190 C 280,155 370,165 450,190 C 370,205 280,210 240,190 Z" fill="rgba(244, 63, 94, 0.2)" stroke="#f43f5e" stroke-width="2"/>
    <text x="345" y="232" text-anchor="middle" fill="#f43f5e" font-family="monospace" font-size="10">WALL / SURFACE [${wallMarkers}]</text>
  </svg>`;
}
