// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PreprocessContext, PreprocessResult } from "./types.js";

/**
 * Handles multibody, automotive, robotics, marine, rail, aerospace, and control-block artifacts:
 * `easy5`, `rocets`, `gtsuite`, `sima`, `gensys`, `simpack`, `adams`, `urdf`, `opendrive`,
 * `openscenario`, `simulink`, `jsbsim`.
 */
export async function tryPreprocessMultibodyOrAero(ctx: PreprocessContext): Promise<PreprocessResult | null> {
  const { viewType, content, baseTitle, inlineCode } = ctx;

  switch (viewType) {
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

      return {
        svg,
        metadata: {
          modelName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          modelName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
          stateCount: dynamicStates,
          inputCount,
          outputCount,
          title: model.title || baseTitle,
        },
      };
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

      return {
        svg,
        metadata: {
          engineName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          engineName: model.title || baseTitle,
          componentCount: compCount,
          connectionCount: connCount,
          ...(chamberP !== undefined ? { chamberPressureMpa: chamberP } : {}),
          ...(totalMdot > 0 ? { massFlowKgSec: +totalMdot.toFixed(2) } : {}),
          ...(mainMr !== undefined ? { mixtureRatio: mainMr } : {}),
          title: model.title || baseTitle,
        },
      };
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

      return {
        svg,
        metadata: {
          engineModel: model.title || model.name || baseTitle,
          componentCount: model.components?.length || 0,
          cylinderCount: cylCount,
          ...(dispLiters !== undefined ? { displacementLiters: dispLiters } : {}),
        },
        viewConfigAdditions: {
          code: inlineCode,
          engineModel: model.title || model.name || baseTitle,
          componentCount: model.components?.length || 0,
          cylinderCount: cylCount,
          ...(dispLiters !== undefined ? { displacementLiters: dispLiters } : {}),
          title: model.title || model.name || baseTitle,
        },
      };
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

      return {
        svg,
        metadata: {
          waterDepth,
          lineCount: linesCount,
          vesselName: model.vessels[0]?.name,
          dnvCompliant: dnvReport.summary.allPassed,
          minSafetyFactor: +dnvReport.summary.minSafetyFactor.toFixed(2),
          ...(maxTensionKn !== undefined ? { maxTensionKn } : {}),
        },
        viewConfigAdditions: {
          code: inlineCode,
          waterDepthMeters: waterDepth,
          mooringLinesCount: linesCount,
          watchCircleRadiusMeters: offsetReport.watchCircleRadiusMeters,
          dnvCompliant: dnvReport.summary.allPassed,
          minSafetyFactor: +dnvReport.summary.minSafetyFactor.toFixed(2),
          ...(maxTensionKn !== undefined ? { maxTensionKn } : {}),
          vesselName: model.vessels[0]?.name,
          title: model.vessels[0]?.name ? `${model.vessels[0].name} Mooring System` : baseTitle,
        },
      };
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
      return {
        svg,
        metadata: {
          bodyCount: bodies.length,
          couplingCount: couplings.length,
          wheelsetCount: model.wheelsets.size,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: model.name || baseTitle,
          bodies,
          couplings,
          wheelsetCount: model.wheelsets.size,
        },
      };
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
      return {
        svg,
        metadata: {
          bodyCount: bodies.length,
          jointCount: joints.length,
          forceCount: forces.length,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: model.name || baseTitle,
          bodies,
          joints,
          forces,
        },
      };
    }

    case "adams": {
      const { parseAdams, renderAdamsSvg } = await import("@modelscript/adams");
      const model = parseAdams(content);
      return {
        svg: renderAdamsSvg(model),
        metadata: {
          partCount: model.parts.size,
          jointCount: model.joints.size,
          forceCount: model.forces.size,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: model.title || baseTitle,
          partCount: model.parts.size,
          jointCount: model.joints.size,
          forceCount: model.forces.size,
        },
      };
    }

    case "urdf": {
      const { parseUrdf, renderUrdfIsometric3DSvg } = await import("@modelscript/urdf");
      const robot = parseUrdf(content);
      return {
        svg: renderUrdfIsometric3DSvg(robot),
        metadata: {
          linkCount: robot.links.size,
          jointCount: robot.joints.size,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: robot.name || baseTitle,
          linkCount: robot.links.size,
          jointCount: robot.joints.size,
        },
      };
    }

    case "opendrive": {
      const { parseOpenDrive, renderOpenDriveSvg } = await import("@modelscript/opendrive");
      const map = parseOpenDrive(content);
      return {
        svg: renderOpenDriveSvg(map),
        metadata: {
          roadCount: map.roads.length,
          junctionCount: map.junctions.length,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: map.header?.name || baseTitle,
          roadCount: map.roads.length,
          junctionCount: map.junctions.length,
        },
      };
    }

    case "openscenario": {
      const { parseOpenScenario } = await import("@modelscript/openscenario");
      const { renderOpenScenarioSvg } = await import("@modelscript/diagram/openscenario-diagram-builder");
      const scen = parseOpenScenario(content);
      return {
        svg: renderOpenScenarioSvg({
          title: scen.header.description || baseTitle,
          entities: Array.from(scen.entities.values()).map((e) => {
            const rawE = e as unknown as { name: string; category: string };
            return {
              name: rawE.name,
              category: rawE.category,
            };
          }) as unknown as Parameters<typeof renderOpenScenarioSvg>[0]["entities"],
        }),
        metadata: { entityCount: scen.entities.size },
        viewConfigAdditions: {
          code: inlineCode,
          title: scen.header.description || baseTitle,
          entityCount: scen.entities.size,
        },
      };
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
      const blockCount = rootSys.blocks?.size ?? rootSys.blocks?.length ?? 0;
      const lineCount = rootSys.lines?.length ?? rootSys.lines?.size ?? 0;
      return {
        svg: renderSimulinkSvg(rootSys as unknown as Parameters<typeof renderSimulinkSvg>[0]),
        metadata: {
          blockCount,
          lineCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: model.name || baseTitle,
          blockCount,
          lineCount,
        },
      };
    }

    case "jsbsim": {
      const { parseJsbsim } = await import("@modelscript/jsbsim");
      const { renderJsbsimSvg } = await import("@modelscript/diagram/jsbsim-diagram-builder");
      const doc = parseJsbsim(content);
      return {
        svg: renderJsbsimSvg({
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
        }),
        metadata: { wingspan: doc.model.metrics?.wingspan, emptyWeight: doc.model.massBalance?.emptyWeight },
        viewConfigAdditions: {
          code: inlineCode,
          title: doc.model.name || baseTitle,
          wingspan: doc.model.metrics?.wingspan,
          emptyWeight: doc.model.massBalance?.emptyWeight,
        },
      };
    }

    default:
      return null;
  }
}
