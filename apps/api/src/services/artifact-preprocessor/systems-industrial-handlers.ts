// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { buildPolyglotDiagramFromSource } from "./polyglot-diagram.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

/**
 * Handles Modelica/ModelScript, OWL2, AUTOSAR, PLCopen, QIF, OSCAL, AutomationML,
 * and universal code-thumbnail dialects.
 */
export async function tryPreprocessSystemsOrIndustrial(ctx: PreprocessContext): Promise<PreprocessResult | null> {
  const { viewType, content, baseTitle, inlineCode, originalFilename, resolvedDir, options } = ctx;

  switch (viewType) {
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
      const svg = renderPolyglotDiagramToSvg(diag as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0], {
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
      return {
        svg,
        metadata: {
          classCount,
          axiomCount: ontology.axioms?.length || diag.nodes?.length || 0,
        },
        viewConfigAdditions: {
          code: inlineCode,
          ontologyIri: ontology.iri || undefined,
          title: baseTitle || ontology.iri,
          classes: classCount,
          axioms: ontology.axioms?.length || diag.nodes?.length || 0,
          individuals: indivCount,
        },
      };
    }

    case "modelica-diagram":
    case "modelica-code":
    case "modelica":
    case "ansatz":
    case "polyglot-ansatz": {
      const { preprocessModelicaArtifact } = await import("../modelica-artifact-renderer.js");
      const moRes = await preprocessModelicaArtifact(content, baseTitle, {
        primaryClass: options.primaryClass,
        dependencies: options.dependencies,
      });
      return {
        ...(moRes.svg ? { svg: moRes.svg } : {}),
        metadata: moRes.metadata,
        viewConfigAdditions: {
          ...moRes.viewConfigAdditions,
          ...(options.primaryClass ? { primaryClass: options.primaryClass } : {}),
          code: inlineCode,
          title: moRes.title || baseTitle,
        },
      };
    }

    case "autosar": {
      const { parseArxml } = await import("@modelscript/autosar");
      const { buildAutosarDiagram, renderAutosarSvg } = await import("@modelscript/diagram/autosar-diagram-builder");
      const model = parseArxml(content);
      const diag = buildAutosarDiagram(model as unknown as Parameters<typeof buildAutosarDiagram>[0]);
      return {
        svg: renderAutosarSvg(model as unknown as Parameters<typeof renderAutosarSvg>[0]),
        metadata: {
          dialect: "autosar",
          componentCount: diag.metadata.componentCount,
          portCount: diag.metadata.portCount,
          runnableCount: diag.metadata.runnableCount,
          connectorCount: diag.metadata.connectorCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "autosar",
          componentCount: diag.metadata.componentCount,
          portCount: diag.metadata.portCount,
          runnableCount: diag.metadata.runnableCount,
          connectorCount: diag.metadata.connectorCount,
        },
      };
    }

    case "plcopen": {
      const { parsePlcopen } = await import("@modelscript/plcopen");
      const { buildPlcopenDiagram, renderPlcopenSvg } = await import("@modelscript/diagram/plcopen-diagram-builder");
      const project = parsePlcopen(content, originalFilename);
      const diag = buildPlcopenDiagram(project as unknown as Parameters<typeof buildPlcopenDiagram>[0]);
      return {
        svg: renderPlcopenSvg(project as unknown as Parameters<typeof renderPlcopenSvg>[0]),
        metadata: {
          dialect: "plcopen",
          pouCount: diag.metadata.pouCount,
          inputCount: diag.metadata.inputCount,
          outputCount: diag.metadata.outputCount,
          networkCount: diag.metadata.networkCount,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: diag.title || baseTitle,
          dialect: "plcopen",
          pouName: diag.pouName,
          pouType: diag.pouType,
          blockCount: diag.metadata.networkCount,
          portCount: diag.metadata.inputCount + diag.metadata.outputCount,
          inputCount: diag.metadata.inputCount,
          outputCount: diag.metadata.outputCount,
        },
      };
    }

    case "qif": {
      const { parseQif, evaluateQifSpc } = await import("@modelscript/qif");
      const { renderQif3dIsometricSvg, renderQifMbdHeatmapSvg } =
        await import("@modelscript/diagram/qif-diagram-builder");
      const doc = parseQif(content, originalFilename);
      const spc = evaluateQifSpc(doc);
      const cpks = spc.characteristics.map((c) => c.cpk).filter((v) => Number.isFinite(v));
      const minCpk = cpks.length > 0 ? Math.min(...cpks) : 0;
      const meanCpk = cpks.length > 0 ? cpks.reduce((a, b) => a + b, 0) / cpks.length : 0;
      const spcSummaryLike = {
        minCpk,
        overallPassRate: spc.overallPassRate,
        metrics: spc.characteristics.map((c) => ({
          characteristicId: c.characteristicId,
          characteristicName: c.characteristicName,
          nominalValue: (c.lsl + c.usl) / 2,
          toleranceZone: c.baseTolerance,
          effectiveTolerance: c.effectiveTolerance,
          bonusTolerance: c.meanBonusTolerance,
          mean: c.mean,
          stdDev: c.stdDev,
          cp: c.cp,
          cpk: c.cpk,
          tur: c.tur,
          passRate: c.passRate,
          sampleCount: c.sampleCount,
        })),
      };

      // Check for paired STEP CAD file in upload directory
      let stepContent: string | undefined;
      try {
        const resolvedBase = path.resolve(resolvedDir);
        const stepBase = path.basename(originalFilename).replace(/\.qif$/i, "");
        const candidateNames = [`${stepBase}.step`, `${stepBase}.stp`, "TurbineBladeRoot.step"];
        for (const cand of candidateNames) {
          const candPath = path.resolve(resolvedBase, cand);
          if (!candPath.startsWith(resolvedBase + path.sep)) continue;
          if (fs.existsSync(candPath)) {
            stepContent = fs.readFileSync(candPath, "utf-8");
            break;
          }
        }
      } catch {
        // Paired STEP lookup is best-effort
      }

      if (!stepContent) {
        try {
          const { synthesizeStepAp242FromQif } = await import("@modelscript/qif/step-bridge");
          stepContent = synthesizeStepAp242FromQif(doc);
        } catch {
          // STEP synthesis fallback is optional
        }
      }

      const heatmapSvg = renderQifMbdHeatmapSvg(doc, spcSummaryLike);
      return {
        svg: renderQif3dIsometricSvg(doc, { stepContent, fallbackTitle: baseTitle }),
        metadata: {
          dialect: "qif",
          qpId: doc.qpId,
          featureCount: doc.features.length,
          characteristicCount: doc.characteristics.length,
          actualCount: doc.actuals.length,
          overallPassRate: spc.overallPassRate,
          minCpk,
          meanCpk,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: baseTitle,
          dialect: "qif",
          qpId: doc.qpId,
          featureCount: doc.features.length,
          characteristicCount: doc.characteristics.length,
          actualCount: doc.actuals.length,
          overallPassRate: spc.overallPassRate,
          minCpk,
          meanCpk,
          heatmapSvg,
          ...(stepContent ? { stepCode: stepContent } : {}),
        },
      };
    }

    case "oscal": {
      const { parseOscal } = await import("@modelscript/oscal");
      const { renderOscalBoundarySvg } = await import("@modelscript/diagram/oscal-diagram-builder");
      const doc = parseOscal(content, originalFilename);
      const components = doc.systemImplementation?.components ?? doc.components ?? [];
      const implementedReqs = doc.controlImplementation?.implementedRequirements ?? [];
      const findings = doc.findings ?? [];
      const poamItems = doc.poamItems ?? [];
      const diagramDoc = {
        kind: doc.kind,
        uuid: doc.uuid,
        title: doc.metadata.title || baseTitle,
        systemName: doc.systemCharacteristics?.systemName ?? doc.metadata.title ?? baseTitle,
        securitySensitivityLevel: doc.systemCharacteristics?.securitySensitivityLevel ?? "moderate",
        components,
        implementedRequirements: implementedReqs,
        findings,
        poamItems,
      };
      return {
        svg: renderOscalBoundarySvg(diagramDoc),
        metadata: {
          dialect: "oscal",
          oscalKind: doc.kind,
          componentCount: components.length,
          implementedControlCount: implementedReqs.length,
          findingCount: findings.length,
          poamCount: poamItems.length,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: doc.metadata.title || baseTitle,
          dialect: "oscal",
          oscalKind: doc.kind,
          componentCount: components.length,
          implementedControlCount: implementedReqs.length,
          findingCount: findings.length,
          poamCount: poamItems.length,
        },
      };
    }

    case "automationml":
    case "aml": {
      const { parseAutomationML, runAmlVirtualCommissioning } = await import("@modelscript/automationml");
      const { renderAmlTopologySvg } = await import("@modelscript/diagram/aml-diagram-builder");
      const doc = parseAutomationML(content, originalFilename);
      const cosim = runAmlVirtualCommissioning(doc, { cycles: 10, dtMs: 10 });
      const interlocksOk = cosim.interlockStatus === "OK";
      const ihCount = doc.instanceHierarchies.length;
      const elemCount = doc.instanceHierarchies.reduce((acc, ih) => acc + ih.elements.length, 0);
      return {
        svg: renderAmlTopologySvg(doc, {
          cycles: cosim.cycles,
          dtMs: cosim.dtMs,
          interlocksOk,
        }),
        metadata: {
          dialect: "automationml",
          schemaVersion: doc.schemaVersion,
          hierarchyCount: ihCount,
          elementCount: elemCount,
          interlocksOk,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: doc.fileName || baseTitle,
          dialect: "automationml",
          schemaVersion: doc.schemaVersion,
          hierarchyCount: ihCount,
          elementCount: elemCount,
          interlocksOk,
        },
      };
    }

    case "modelscript": {
      const { renderPolyglotDiagramToSvg } = await import("@modelscript/diagram/svg");
      const dslLang = viewType;
      const diag = buildPolyglotDiagramFromSource(content, dslLang, baseTitle);
      const svg =
        diag.nodes.length > 0
          ? renderPolyglotDiagramToSvg(diag as unknown as Parameters<typeof renderPolyglotDiagramToSvg>[0], {
              theme: "dark",
            })
          : undefined;
      return {
        ...(svg ? { svg } : {}),
        metadata: {
          nodeCount: diag.nodes.length,
          connectionCount: diag.edges.length,
          dialect: dslLang,
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: baseTitle,
          dialect: dslLang,
          nodeCount: diag.nodes.length,
          connectionCount: diag.edges.length,
        },
      };
    }

    case "fortran":
    case "f90":
    case "f95":
    case "f08":
    case "f18":
    case "c":
    case "cpp":
    case "scad":
    case "csg":
    case "ccsds":
    case "energyplus":
    case "reqif": {
      let svgCode: string | undefined;
      if (inlineCode) {
        try {
          const { renderUniversalCodeThumbnailSvg } = await import("@modelscript/diagram/code-thumbnail-builder");
          svgCode = renderUniversalCodeThumbnailSvg(inlineCode, {
            dialect: viewType,
            title: baseTitle,
          });
        } catch {
          // Fall through if diagram builder unavailable
        }
      }
      return {
        ...(svgCode ? { svg: svgCode } : {}),
        metadata: {
          dialect: viewType,
          previewMode: "code",
        },
        viewConfigAdditions: {
          code: inlineCode,
          title: baseTitle,
          dialect: viewType,
          previewMode: "code",
          ...(svgCode ? { svg: svgCode } : {}),
        },
      };
    }

    default:
      return null;
  }
}
