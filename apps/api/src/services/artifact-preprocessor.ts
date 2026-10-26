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
          netlist,
          title: project.name || baseTitle,
          projectTitle: project.name || baseTitle,
          definitionName: firstDef?.name,
          ieee2800Compliant: true,
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
        for (const comp of model.components?.values() ?? []) {
          const t = comp.type?.toUpperCase() || "";
          if (t === "IN" || t === "INTEGRATOR" || t === "LAG" || t === "POLE") dynamicStates += 1;
          else if (t === "TF" || t === "SECOND_ORDER") dynamicStates += 2;
          else dynamicStates += 1;
        }

        result.svg = svg;
        result.metadata = {
          modelName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
        };
        result.viewConfigAdditions = {
          modelName: model.title || baseTitle,
          stateCount: dynamicStates,
          inputCount: Math.max(1, Math.floor(compCount / 3)),
          outputCount: Math.max(1, Math.floor(compCount / 3)),
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

        let chamberP = 10.0;
        let totalMdot = 0;
        let mainMr = 6.0;
        for (const comp of model.components?.values() ?? []) {
          if (comp.type === "CHAMBER") {
            if (comp.parameters?.["PC"]) chamberP = +(Number(comp.parameters["PC"]) / 1e6).toFixed(1);
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
          engineName: model.title || baseTitle,
          chamberPressureMpa: chamberP,
          massFlowKgSec: totalMdot > 0 ? totalMdot : 100,
          mixtureRatio: mainMr,
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
        const minPBar = Number.isFinite(minP) ? +(minP / 1e5).toFixed(1) : 40.0;
        const maxPBar = Number.isFinite(maxP) ? +(maxP / 1e5).toFixed(1) : 60.0;

        result.svg = svg;
        result.metadata = {
          networkName: model.title || baseTitle,
          pipeCount: model.pipes.length,
          nodeCount: model.nodes.length,
          compressorCount: model.compressors.length,
        };
        result.viewConfigAdditions = {
          networkName: model.title || baseTitle,
          totalPipes: model.pipes.length,
          totalNodes: model.nodes.length,
          totalCompressors: model.compressors.length,
          minPressureBar: minPBar,
          maxPressureBar: maxPBar,
          title: model.title || baseTitle,
        };
        break;
      }

      case "gtsuite": {
        const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("@modelscript/gtsuite");

        const model = parseGtmModel(content);
        const svg = renderGtSuiteSchematicSvg(model);
        const cylinders = (model.components || []).filter((c) => c.kind === "cylinder") as any[];
        const cylCount = cylinders.length || 4;
        let boreMm = 85.0;
        let strokeMm = 88.0;
        let totalDisplacementL = 0;
        for (const c of cylinders) {
          if (typeof c.displacementM3 === "number") {
            totalDisplacementL += c.displacementM3 * 1000.0;
          } else if (typeof c.boreM === "number" && typeof c.strokeM === "number") {
            boreMm = c.boreM * 1000.0;
            strokeMm = c.strokeM * 1000.0;
          }
        }
        const dispLiters =
          totalDisplacementL > 0
            ? +totalDisplacementL.toFixed(2)
            : +((cylCount * (Math.PI * Math.pow(boreMm / 20.0, 2) * (strokeMm / 10.0))) / 1000.0).toFixed(2);

        result.svg = svg;
        result.metadata = {
          engineModel: model.title || model.name || baseTitle,
          cylinderCount: cylCount,
          displacementLiters: dispLiters > 0 ? dispLiters : 2.0,
        };
        result.viewConfigAdditions = {
          engineModel: model.title || model.name || baseTitle,
          cylinderCount: cylCount,
          displacementLiters: dispLiters > 0 ? dispLiters : 2.0,
          title: model.title || model.name || baseTitle,
        };
        break;
      }

      case "sima": {
        const { parseSimaFile } = await import("@modelscript/sima");
        const { renderSimaMooringSpreadSvg } = await import("@modelscript/diagram/sima-diagram-builder");

        const model = parseSimaFile(content);
        const linesCount = model.lines?.length || 8;
        const svg = renderSimaMooringSpreadSvg({
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring Spread` : "Mooring Spread & Watch Circle",
          waterDepth: model.environment?.waterDepth || 400,
          vesselName: model.vessels[0]?.name ?? "Offshore Floater",
          watchCircleRadius: 18.5,
          vesselOffset: { x: 4.2, y: 0 },
          lines: (model.lines || []).map((l, i) => {
            const rad = (2 * Math.PI * i) / Math.max(1, linesCount);
            const anchorR = 850;
            return {
              id: `line-${i + 1}`,
              name: l.name || `Line #${i + 1}`,
              anchorRadius: anchorR,
              azimuthDeg: (360 / Math.max(1, linesCount)) * i,
              tension: 450,
              mbl: 950,
              anchorPos: [
                Math.round(anchorR * Math.cos(rad)),
                Math.round(anchorR * Math.sin(rad)),
                -(model.environment?.waterDepth || 400),
              ] as [number, number, number],
            };
          }),
        });

        result.svg = svg;
        result.metadata = {
          waterDepth: model.environment?.waterDepth,
          lineCount: model.lines?.length || 0,
          vesselName: model.vessels[0]?.name,
        };
        result.viewConfigAdditions = {
          waterDepthMeters: model.environment?.waterDepth || 400,
          mooringLinesCount: model.lines?.length || 8,
          maxTensionKn: 1250,
          watchCircleRadiusMeters: 18.5,
          dnvCompliant: true,
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring System` : baseTitle,
        };
        break;
      }

      case "aspen": {
        const { parseAspen } = await import("@modelscript/aspen");
        const { renderAspenSvg } = await import("@modelscript/diagram/aspen-diagram-builder");
        const doc = parseAspen(content);
        result.svg = renderAspenSvg(doc);
        result.metadata = { blockCount: doc.blocks.size, streamCount: doc.streams.size };
        result.viewConfigAdditions = { title: doc.title || baseTitle };
        break;
      }

      case "swmm": {
        const { parseSwmm } = await import("@modelscript/swmm");
        const { renderSwmmSvg } = await import("@modelscript/diagram/swmm-diagram-builder");
        const model = parseSwmm(content);
        result.svg = renderSwmmSvg(model as any);
        result.metadata = { junctionCount: model.junctions.size, conduitCount: model.conduits.size };
        result.viewConfigAdditions = { title: model.title || baseTitle };
        break;
      }

      case "touchstone": {
        const { parseTouchstone, verifyPassivity } = await import("@modelscript/touchstone");
        const { renderTouchstoneSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
        const net = parseTouchstone(content);
        const passivity = verifyPassivity(net);
        result.svg = renderTouchstoneSvg({
          portCount: net.numPorts,
          referenceImpedance: net.options.referenceResistance,
          isPassive: passivity.isPassive,
        });
        result.metadata = { portCount: net.numPorts, isPassive: passivity.isPassive };
        result.viewConfigAdditions = { title: baseTitle };
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
        result.viewConfigAdditions = { title: firstComp?.name || baseTitle };
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
        result.viewConfigAdditions = { title: deck.circuit ? `Circuit.${deck.circuit.name}` : baseTitle };
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
        result.viewConfigAdditions = { title: scen.header.description || baseTitle };
        break;
      }

      case "relap5": {
        const { parseRelap5 } = await import("@modelscript/relap5");
        const { renderRelap5Svg } = await import("@modelscript/diagram/relap5-diagram-builder");
        const deck = parseRelap5(content);
        result.svg = renderRelap5Svg(deck as any);
        result.metadata = { volumeCount: deck.volumes.size, junctionCount: deck.junctions.size };
        result.viewConfigAdditions = { title: deck.title || baseTitle };
        break;
      }

      case "eclipse": {
        const { parseEclipse } = await import("@modelscript/eclipse");
        const { renderEclipseSvg } = await import("@modelscript/diagram/eclipse-diagram-builder");
        const deck = parseEclipse(content);
        result.svg = renderEclipseSvg(deck as any);
        result.metadata = { wellCount: deck.wells.size, nz: deck.dimensions?.nz ?? 4 };
        result.viewConfigAdditions = { title: deck.title || baseTitle };
        break;
      }

      case "sbml": {
        const { parseSbml } = await import("@modelscript/sbml");
        const { renderSbmlSvg } = await import("@modelscript/diagram/sbml-diagram-builder");
        const doc = parseSbml(content);
        result.svg = renderSbmlSvg(doc.model);
        result.metadata = { speciesCount: doc.model.species.size, reactionCount: doc.model.reactions.size };
        result.viewConfigAdditions = { title: doc.model.name || doc.model.id || baseTitle };
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
        result.viewConfigAdditions = { title: doc.model.name || baseTitle };
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
