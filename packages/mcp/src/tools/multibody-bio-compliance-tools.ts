// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { evaluateEn14363, lintGensysModel, parseGensysDeck, solveFastsim } from "@modelscript/gensys";
import { analyzeMobility, lintSimpackModel, parseSimDeck, parseSpckXml } from "@modelscript/simpack";
import { z } from "zod";
import { withSandbox } from "../sandbox.js";
import type { ServerContext } from "../types.js";
import { getErrorMessage, resolveSourceOrWorkspaceFile } from "./shared.js";
export function registerMultibodyBioComplianceTools(server: McpServer, ctx: ServerContext): void {
  // ── gensys_lint ──────────────────────────────────────────────────────────
  server.tool(
    "gensys_lint",
    "Perform pre-flight semantic and physical validation on GENSYS railway vehicle models (.calc, .run, .sub).",
    {
      source: z.string().describe("GENSYS deck text content or file path"),
    },
    async ({ source }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const model = parseGensysDeck(content);
        const diags = lintGensysModel(model);
        return { content: [{ type: "text" as const, text: JSON.stringify(diags, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `GENSYS lint error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── gensys_verify_en14363 ────────────────────────────────────────────────
  server.tool(
    "gensys_verify_en14363",
    "Verify derailment quotient (Y/Q <= 0.8) and Prud'homme lateral track shifting force limits according to EN 14363 / UIC 518.",
    {
      lateralForceY: z.number().describe("Lateral wheel force Y [kN]"),
      verticalForceQ: z.number().describe("Vertical wheel force Q [kN]"),
      nominalAxleLoadQ0: z.number().default(160.0).describe("Nominal axle load 2*Q0 in kN"),
    },
    withSandbox(
      "gensys_verify_en14363",
      async (params) => {
        const result = evaluateEn14363(params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── gensys_fastsim ───────────────────────────────────────────────────────
  server.tool(
    "gensys_fastsim",
    "Compute tangential longitudinal/lateral creep forces and spin moment using Kalker's FASTSIM algorithm.",
    {
      normalForce: z.number().describe("Wheel normal load Q [N]"),
      longitudinalCreep: z.number().describe("Longitudinal creepage xi_x [-]"),
      lateralCreep: z.number().describe("Lateral creepage xi_y [-]"),
      spin: z.number().default(0.0).describe("Spin creepage phi_z [rad/m]"),
      ellipseSemiMajor: z.number().default(0.006).describe("Contact ellipse semi-major axis a [m]"),
      ellipseSemiMinor: z.number().default(0.005).describe("Contact ellipse semi-minor axis b [m]"),
      frictionCoeff: z.number().default(0.35).describe("Friction coefficient mu [-]"),
    },
    withSandbox(
      "gensys_fastsim",
      async (params) => {
        const result = solveFastsim({
          normalForce: params.normalForce,
          longitudinalCreep: params.longitudinalCreep,
          lateralCreep: params.lateralCreep,
          spin: params.spin,
          ellipseSemiMajor: params.ellipseSemiMajor,
          ellipseSemiMinor: params.ellipseSemiMinor,
          shearModulus: 8.2e10,
          poissonRatio: 0.28,
          frictionCoeff: params.frictionCoeff,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── simpack_lint ─────────────────────────────────────────────────────────
  server.tool(
    "simpack_lint",
    "Perform structural and reference diagnostics on SIMPACK XML (.spck) or classic deck (.sim, .mbs) files.",
    {
      source: z.string().describe("SIMPACK XML or ASCII deck content or file path"),
    },
    async ({ source }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const isXml = content.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(content) : parseSimDeck(content);
        const diags = lintSimpackModel(model);
        return { content: [{ type: "text" as const, text: JSON.stringify(diags, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `SIMPACK lint error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── simpack_mobility ─────────────────────────────────────────────────────
  server.tool(
    "simpack_mobility",
    "Calculate system degrees of freedom and overconstrained mechanisms using Grübler-Kutzbach spatial criterion.",
    {
      source: z.string().describe("SIMPACK XML or ASCII deck content or file path"),
    },
    withSandbox(
      "simpack_mobility",
      async ({ source }) => {
        try {
          const content = resolveSourceOrWorkspaceFile(source);
          const isXml = content.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(content) : parseSimDeck(content);
          const mobility = analyzeMobility(model);
          return { content: [{ type: "text" as const, text: JSON.stringify(mobility, null, 2) }] };
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: `SIMPACK mobility error: ${getErrorMessage(err)}` }],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ---------------------------------------------------------------------------
  // NIST Strategic Standards: QIF (ISO 23952), OSCAL (SP 800-53/82), & AutomationML (IEC 62714)
  // ---------------------------------------------------------------------------

  server.tool(
    "qif_inspect_and_spc",
    "Evaluates an ISO 23952 Quality Information Framework (QIF) document, runs NIST QIF & ASME Y14.5 GD&T lint checks, computes SPC capability (Cp/Cpk, TUR, MMC/LMC bonus tolerances), and optionally reconciles STEP AP242 entities.",
    {
      qifContent: z.string().describe("QIF 3.0 XML, DSL, or JSON document content"),
      stepContent: z.string().optional().describe("Optional STEP AP242 CAD content for entity ID reconciliation"),
    },
    async ({ qifContent, stepContent }) => {
      const { evaluateQifSpc, lintQifDocument, parseQif, reconcileStepWithQif } = await import("@modelscript/qif");
      const doc = parseQif(qifContent);
      const diagnostics = lintQifDocument(doc);
      const spc = evaluateQifSpc(doc);
      const stepReconciliation = stepContent ? reconcileStepWithQif(stepContent, doc) : undefined;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                qpId: doc.qpId,
                diagnostics,
                spc,
                stepReconciliation,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "oscal_audit_cps_compliance",
    "Audits a NIST OSCAL document (Catalog, Profile, Component Definition, SSP, SAR, or POA&M) against NIST SP 800-53 Rev 5 and SP 800-82 Rev 3 OT/ICS overlays, resolves profile baselines, and verifies cyber-physical architectural component coverage.",
    {
      oscalContent: z.string().describe("OSCAL JSON, YAML, or XML content"),
      architectureComponents: z
        .array(
          z.object({
            name: z.string(),
            kind: z.string(),
            isSafetyCritical: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Optional list of SysML v2 / AutomationML / PLCopen components to verify coverage against"),
    },
    async ({ oscalContent, architectureComponents }) => {
      const { auditCpsArchitectureCompliance, lintOscalDocument, parseOscal, resolveOscalProfile } =
        await import("@modelscript/oscal");
      const doc = parseOscal(oscalContent);
      const diagnostics = lintOscalDocument(doc);
      const resolvedProfile = resolveOscalProfile(doc);
      const comps =
        architectureComponents ??
        (doc.systemImplementation?.components ?? doc.components ?? []).map((c) => ({
          name: c.title,
          kind: c.type,
          isSafetyCritical: c.type === "plc" || c.type === "ied" || c.type === "ot-controller",
        }));
      const cpsAudit = auditCpsArchitectureCompliance(doc, comps);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                uuid: doc.uuid,
                kind: doc.kind,
                diagnostics,
                resolvedControlCount: resolvedProfile.controls.length,
                cpsAudit,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "aml_run_virtual_commissioning",
    "Parses an IEC 62714 AutomationML / CAEX workcell topology, runs semantic port & PPR role verification, and executes closed-loop virtual commissioning coupling VirtualPlc logic and mechatronic plant dynamics.",
    {
      amlContent: z.string().describe("AutomationML CAEX XML or declarative AML content"),
      cycles: z.number().optional().default(20).describe("Number of virtual commissioning scan cycles"),
      dtMs: z.number().optional().default(10).describe("Scan cycle time step in milliseconds"),
    },
    async ({ amlContent, cycles, dtMs }) => {
      const { lintAutomationML, parseAutomationML, runAmlVirtualCommissioning } =
        await import("@modelscript/automationml");
      const doc = parseAutomationML(amlContent);
      const diagnostics = lintAutomationML(doc);
      const commissioning = runAmlVirtualCommissioning(doc, { cycles, dtMs });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                fileName: doc.fileName,
                schemaVersion: doc.schemaVersion,
                diagnostics,
                commissioning,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Radiology, Radiation Oncology & Computer-Assisted Surgery Tools
  // ---------------------------------------------------------------------------

  server.tool(
    "opensim_analyze",
    "Parses an OpenSim (.osim) musculoskeletal biomechanics model, runs pre-flight kinematic and Hill-type muscle diagnostics (M9101–M9110), and simulates muscle activation/contraction dynamics.",
    {
      opensimContent: z.string().describe("OpenSim .osim XML model content"),
      duration: z.number().optional().default(0.5).describe("Simulation duration in seconds"),
      dt: z.number().optional().default(0.01).describe("Integration time step in seconds"),
    },
    async ({ opensimContent, duration, dt }) => {
      const { lintOpenSimDocument, lowerOpenSimToDae, parseOpenSim, simulateMuscleDynamics } =
        await import("@modelscript/opensim");
      const doc = parseOpenSim(opensimContent);
      const diagnostics = lintOpenSimDocument(doc);
      const simulation = simulateMuscleDynamics(doc, { duration, dt });
      const dae = lowerOpenSimToDae(doc);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                modelName: doc.modelName,
                diagnostics,
                daeVariableCount: dae.getVarCount(),
                daeEquationCount: dae.getEqCount(),
                simulation,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "dicom_rt_verify_dvh",
    "Evaluates a DICOM-RT treatment plan (RTPLAN, RTSTRUCT, RTDOSE), verifies QUANTEC OAR dose constraints, MLC leaf kinematics, and gantry/couch collision clearance (M9201–M9210), and computes DVH, CI, HI, BED, and EQD2 metrics.",
    {
      dicomRtContent: z.string().describe("DICOM-RT XML, JSON, or declarative plan content"),
    },
    async ({ dicomRtContent }) => {
      const { evaluateDicomRtDosimetry, lintDicomRtDocument, parseDicomRt } = await import("@modelscript/dicom-rt");
      const doc = parseDicomRt(dicomRtContent);
      const diagnostics = lintDicomRtDocument(doc);
      const dosimetry = evaluateDicomRtDosimetry(doc);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                planId: doc.planId,
                prescribedDoseGy: doc.prescribedDoseGy,
                fractions: doc.fractions,
                diagnostics,
                dosimetry,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "cellml_simulate",
    "Parses a CellML 1.0/1.1/2.0 electrophysiology or microvascular perfusion model, verifies SI dimensional consistency and component interfaces (M9301–M9310), and integrates action potential / gating ODEs.",
    {
      cellmlContent: z.string().describe("CellML .cellml XML model content"),
      duration: z.number().optional().default(1.0).describe("Simulation duration"),
      dt: z.number().optional().default(0.01).describe("Integration step size"),
    },
    async ({ cellmlContent, duration, dt }) => {
      const { lintCellmlDocument, lowerCellmlToDae, parseCellml, solveCellml } = await import("@modelscript/cellml");
      const doc = parseCellml(cellmlContent);
      const diagnostics = lintCellmlDocument(doc);
      const simulation = solveCellml(doc, { duration, dt });
      const dae = lowerCellmlToDae(doc);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                modelName: doc.name,
                diagnostics,
                daeVariableCount: dae.getVarCount(),
                daeEquationCount: dae.getEqCount(),
                simulation,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "igtl_verify_calibration",
    "Parses an OpenIGTLink / PLUS surgical navigation configuration, verifies SE(3) rotation orthogonality and coordinate frame connectivity (M9801–M9810), and solves stylus pivot calibration and Fitzpatrick Target Registration Error (TRE).",
    {
      igtlContent: z.string().describe("PLUS .plus.xml or OpenIGTLink .igtl content"),
    },
    async ({ igtlContent }) => {
      const { lintIgtlDocument, parseIgtl, solveTransformChainAndPivot } = await import("@modelscript/igtl");
      const doc = parseIgtl(igtlContent);
      const diagnostics = lintIgtlDocument(doc);
      const navigation = solveTransformChainAndPivot(doc);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                diagnostics,
                navigation,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "three_mf_verify_guide",
    "Verifies an ISO/ASTM 52915 3MF Medical patient-specific surgical cutting guide or implant mesh for 2-manifold watertightness, outward normal volume, wall thickness, osteotomy plane normals, and biocompatibility (M9701–M9710).",
    {
      threeMfContent: z.string().describe("3MF XML .3mf / .model content"),
    },
    async ({ threeMfContent }) => {
      const { lintThreeMfDocument, parseThreeMf, verifyMeshTopology } = await import("@modelscript/three-mf");
      const doc = parseThreeMf(threeMfContent);
      const diagnostics = lintThreeMfDocument(doc);
      const topology = verifyMeshTopology(doc);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                diagnostics,
                topology,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
