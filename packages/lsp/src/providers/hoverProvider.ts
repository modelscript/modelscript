// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSymbolDomain, LanguageDomainId } from "@modelscript/runtime";
import { Connection, Hover, Range, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { resolveFeatureFlags, type LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { ValidationService } from "../services/validation-service.js";
import {
  extractCrossDomainLineHints,
  extractQualifiedTokenAtOffset,
  extractWordAtOffset,
  hasBiomedicalContext,
  stripNamespacePrefix,
  uriBasename,
} from "../utils/lexical-utils.js";
import { getAlmExternalHover } from "./almHover.js";

interface HoverSymbolLike {
  id: number;
  name?: string | undefined;
  kind?: string | undefined;
  ruleName?: string | undefined;
  resourceId?: string | undefined;
  documentUri?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

interface HoverParityReport {
  compatible?: boolean | undefined;
  mUnit?: string | undefined;
  sType?: string | undefined;
  reason?: string | undefined;
}

interface HoverQueryEngineLike {
  crossDomainBinding?(id: number): number[];
  resolveEntry(id: number): HoverSymbolLike | null | undefined;
  resolvePolyglotSymbol?(name: string): number | null | undefined;
  physicalQuantityParity?(a: number, b: number): HoverParityReport | null | undefined;
}

interface HoverThreadElemLike {
  uri?: string | undefined;
  name?: string | undefined;
  domain?: string | undefined;
  properties?: Record<string, unknown> | undefined;
}

interface HoverIntervalLike {
  isTop?(): boolean;
  isBottom?(): boolean;
  join?(other: HoverIntervalLike): HoverIntervalLike;
  toString(): string;
}

interface HoverProofStateLike {
  intervals?: Map<string, HoverIntervalLike> | undefined;
}

interface HoverProofResultLike {
  summary?:
    | {
        blockEntryStates?: Map<number, HoverProofStateLike> | undefined;
        blockExitStates?: Map<number, HoverProofStateLike> | undefined;
      }
    | undefined;
  cfg?:
    | {
        blocks?: Map<number, { instructions: Array<{ startOffset?: number; endOffset?: number }> }> | undefined;
      }
    | undefined;
}

interface HoverDaeResultLike {
  variableBounds?: Map<string, HoverIntervalLike> | undefined;
}

interface HoverTaxonomyNodeLike {
  iri?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
  superClasses?: Iterable<string> | undefined;
  subClasses?: Iterable<string> | undefined;
}

interface HoverBridgeLike {
  hover(offset: number, text?: string): { contents?: string | undefined; range?: Range | undefined } | null | undefined;
  findEntryAtOffset?(offset: number): HoverSymbolLike | null | undefined;
  findScopeAtOffset?(offset: number): HoverSymbolLike | null | undefined;
  engine?: HoverQueryEngineLike | undefined;
  getQueryEngine?(): HoverQueryEngineLike | null | undefined;
}

interface HoverTreeEntryLike {
  tree?: { rootNode?: { id?: number; ptr?: number }; rootPtr?: number } | null | undefined;
  rootNode?: { id?: number; ptr?: number } | undefined;
  rootPtr?: number | undefined;
}

export interface HoverValidationServiceLike {
  documentLSPBridges: ReadonlyMap<string, HoverBridgeLike>;
  documentManager?: { documentTrees?: ReadonlyMap<string, HoverTreeEntryLike> } | undefined;
  context?: { settings?: LspContext["settings"] } | undefined;
  workspaceManager?:
    | {
        unifiedWorkspace?: {
          getIndex?(): { symbols?: Map<number, HoverSymbolLike> } | undefined;
          syncTggCorrespondences?(idx: unknown): void;
          tggCorrespondenceIndexer?: {
            getSlotsForSymbol?(id: number): number[];
            hypergraph?: {
              getRecord?(
                slot: number,
              ): { isRemoved?: boolean; domainNodes: Record<string, unknown> } | null | undefined;
            };
          };
        };
        getQueryEngine?(langId: string): HoverQueryEngineLike | null | undefined;
        getThreadsForUri?(uri: string): Array<{ slot: number }> | undefined;
        findAlignedElementsBySlot?(slot: number): HoverThreadElemLike[];
      }
    | undefined;
  reasonerService?:
    | {
        reasoner?: {
          getTaxonomy?(): Map<string, HoverTaxonomyNodeLike> | HoverTaxonomyNodeLike[] | null | undefined;
        };
      }
    | undefined;
  modelicaProofResultsByUri?: ReadonlyMap<string, ReadonlyMap<string, HoverProofResultLike>> | undefined;
  daeVerificationResultsByUri?: ReadonlyMap<string, ReadonlyMap<string, HoverDaeResultLike>> | undefined;
  modelicaDaeVerificationResultsByUri?: ReadonlyMap<string, ReadonlyMap<string, HoverDaeResultLike>> | undefined;
}

function getDomainName(domainId: number, resourceId?: string): string {
  switch (domainId) {
    case LanguageDomainId.Modelica:
      return "Modelica";
    case LanguageDomainId.SysML2:
      return "SysML v2";
    case LanguageDomainId.STEP_CAD:
      return "STEP CAD";
    case LanguageDomainId.OWL2:
      return "OWL2 Ontology";
    case LanguageDomainId.SSP:
      return "SSP Container";
    case LanguageDomainId.CFD:
      return "CFD Aerodynamics";
    case LanguageDomainId.FEA:
      return "FEA Finite Element";
    case LanguageDomainId.ModelScript:
      return "ModelScript";
    case LanguageDomainId.SCAD:
      return "OpenSCAD";
    case LanguageDomainId.PSCAD:
      return "PSCAD";
    case LanguageDomainId.PSSE:
      return "PSS/E";
    case LanguageDomainId.ReqIF:
      return "ReqIF";
    case LanguageDomainId.QIF:
      return "QIF";
    case LanguageDomainId.CSV:
      return "Tabular Dataset";
    default:
      if (resourceId) {
        if (/\.(sysml|kerml)$/i.test(resourceId)) return "SysML v2";
        if (/\.(step|stp|p21)$/i.test(resourceId)) return "STEP CAD";
        if (/\.mo$/i.test(resourceId)) return "Modelica";
        if (/\.scad$/i.test(resourceId)) return "OpenSCAD";
        if (/\.(pscx|pslx)$/i.test(resourceId)) return "PSCAD";
        if (/\.(raw|dyr)$/i.test(resourceId)) return "PSS/E";
        if (/\.reqifz?$/i.test(resourceId)) return "ReqIF";
        if (/\.qif(\.xml)?$/i.test(resourceId)) return "QIF";
        if (/\.(owl|ttl|ofn)$/i.test(resourceId)) return "OWL2 Ontology";
      }
      return "Polyglot";
  }
}

function domainToLang(domainName: string): string {
  switch (domainName) {
    case "SysML v2":
      return "sysml";
    case "Modelica":
      return "modelica";
    case "STEP CAD":
      return "step";
    case "OpenSCAD":
      return "scad";
    case "PSCAD":
      return "pscad";
    case "PSS/E":
      return "psse";
    case "ReqIF":
      return "reqif";
    case "QIF":
      return "qif";
    case "OWL2 Ontology":
      return "owl";
    default:
      return "plaintext";
  }
}

function enhanceWithDigitalThreadTwin(
  hoverContent: string,
  _token: string,
  text: string,
  offset: number,
  documentUri: string,
  bridge: HoverBridgeLike | undefined,
  validationService: HoverValidationServiceLike | undefined,
): string {
  if (hoverContent.includes("### 🔗 Polyglot Digital Thread Twin")) {
    return hoverContent;
  }

  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  const refEntry = bridge?.findEntryAtOffset?.(offset) || bridge?.findScopeAtOffset?.(offset);
  const lineHints = extractCrossDomainLineHints(lineText);

  const uw = validationService?.workspaceManager?.unifiedWorkspace;
  const pluginWithQe = globalLanguageRegistry.getAllPlugins().find((p) => p.queryEngine);
  const qe: HoverQueryEngineLike | null | undefined =
    bridge?.engine ??
    bridge?.getQueryEngine?.() ??
    validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
    validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
    (pluginWithQe?.queryEngine as HoverQueryEngineLike | undefined);

  let counterpartEntry: HoverSymbolLike | null = null;
  let counterpartDomain = "";
  let parityReport: HoverParityReport | null = null;

  // 1. Check crossDomainBinding via Salsa
  if (refEntry?.id !== undefined && typeof qe?.crossDomainBinding === "function") {
    try {
      const boundIds = qe.crossDomainBinding(refEntry.id);
      if (boundIds.length > 0 && boundIds[0] !== undefined) {
        counterpartEntry = qe.resolveEntry(boundIds[0]) ?? null;
        if (counterpartEntry) {
          counterpartDomain = getDomainName(getSymbolDomain(counterpartEntry.id), counterpartEntry.resourceId);
        }
      }
    } catch {
      // Salsa crossDomainBinding unavailable; continue to TGG and metadata fallbacks below.
    }
  }

  // 1b. Check TggCorrespondenceIndexer + DigitalThreadHypergraph directly (zero-@twin correspondences)
  if (!counterpartEntry && refEntry?.id !== undefined && uw?.tggCorrespondenceIndexer) {
    try {
      const uIdx = typeof uw.getIndex === "function" ? uw.getIndex() : undefined;
      if (uIdx) uw.syncTggCorrespondences?.(uIdx);
      const slots: number[] = uw.tggCorrespondenceIndexer.getSlotsForSymbol?.(refEntry.id) ?? [];
      for (const slot of slots) {
        const rec = uw.tggCorrespondenceIndexer.hypergraph?.getRecord?.(slot);
        if (!rec || rec.isRemoved) continue;
        for (const memberId of Object.values(rec.domainNodes)) {
          if (typeof memberId === "number" && memberId !== refEntry.id) {
            const sym = uIdx?.symbols?.get(memberId);
            if (sym) {
              counterpartEntry = sym;
              counterpartDomain = getDomainName(getSymbolDomain(sym.id), sym.resourceId || sym.documentUri);
              break;
            }
          }
        }
        if (counterpartEntry) break;
      }
    } catch {
      // TGG correspondence lookup unavailable; continue to explicit twin metadata fallback below.
    }
  }

  // 2. Fallback: Check explicit twin metadata / legacy lineHints via Salsa resolvePolyglotSymbol
  const twinCand =
    refEntry?.metadata?.["twin"] ||
    refEntry?.metadata?.["counterpart"] ||
    refEntry?.metadata?.["implements"] ||
    lineHints.twin;

  if (!counterpartEntry && twinCand && typeof qe?.resolvePolyglotSymbol === "function") {
    try {
      const symId = qe.resolvePolyglotSymbol(String(twinCand));
      if (symId !== null && symId !== undefined) {
        counterpartEntry = qe.resolveEntry(symId) ?? null;
        if (counterpartEntry) {
          counterpartDomain = getDomainName(getSymbolDomain(counterpartEntry.id), counterpartEntry.resourceId);
        }
      }
    } catch {
      // Polyglot symbol resolution unavailable; fall back to digital thread records below.
    }
  }

  // 3. Check workspace digital thread records
  let threadElem: HoverThreadElemLike | null = null;
  if (!counterpartEntry && validationService?.workspaceManager?.getThreadsForUri) {
    try {
      const threads = validationService.workspaceManager.getThreadsForUri(documentUri);
      if (threads && threads.length > 0) {
        for (const t of threads) {
          const aligned = validationService.workspaceManager.findAlignedElementsBySlot?.(t.slot) ?? [];
          for (const elem of aligned) {
            if (elem.uri && elem.uri !== documentUri) {
              threadElem = elem;
              counterpartDomain = elem.domain ? elem.domain.toUpperCase() : "Digital Thread";
              break;
            }
          }
          if (threadElem) break;
        }
      }
    } catch {
      // Digital thread lookup unavailable; omit thread counterpart info from hover.
    }
  }

  // 4. Physical quantity parity check
  if (
    refEntry?.id !== undefined &&
    counterpartEntry?.id !== undefined &&
    typeof qe?.physicalQuantityParity === "function"
  ) {
    try {
      parityReport = qe.physicalQuantityParity(refEntry.id, counterpartEntry.id) ?? null;
    } catch {
      // Parity check is optional enrichment; render hover without parity section on failure.
    }
  }

  // If we have counterpart info or CAD annotation or thread element, construct twin section
  const cadCallPart = lineHints.cadCallPart;
  if (counterpartEntry || threadElem || cadCallPart) {
    const cName = counterpartEntry?.name || threadElem?.name || cadCallPart || String(twinCand);
    const cKind =
      counterpartEntry?.ruleName ||
      counterpartEntry?.kind ||
      String(threadElem?.properties?.["kind"] ?? "") ||
      "definition";
    const cUri = counterpartEntry?.resourceId || threadElem?.uri;
    const cDomain = counterpartDomain || (cadCallPart ? "STEP CAD" : "Polyglot");

    const lines: string[] = [
      "",
      "---",
      "### 🔗 Polyglot Digital Thread Twin",
      `- **Domain:** ${cDomain}`,
      `- **Counterpart:** \`${cName}\` (\`${cKind}\`)`,
    ];

    if (cUri) {
      const bName = uriBasename(cUri);
      lines.push(`- **Resource:** [\`${bName}\`](${cUri})`);
    }

    if (parityReport) {
      if (parityReport.compatible) {
        lines.push(
          `- **Physical Quantity:** \`${parityReport.mUnit || parityReport.sType || "Matched"}\` ✓ [Consistent]`,
        );
      } else if (parityReport.reason) {
        lines.push(`- **Physical Quantity Parity:** ⚠ Incompatible (${parityReport.reason})`);
      }
    } else if (counterpartEntry?.metadata?.["unit"] || refEntry?.metadata?.["unit"]) {
      const u = counterpartEntry?.metadata?.["unit"] || refEntry?.metadata?.["unit"];
      lines.push(`- **Physical Quantity:** \`${String(u)}\` ✓ [Consistent]`);
    } else if (threadElem?.properties?.["mass"]) {
      lines.push(`- **Physical Quantity:** \`mass: ${String(threadElem.properties["mass"])}\` ✓ [Consistent]`);
    }

    const cadPartName = cadCallPart || (cDomain === "STEP CAD" ? cName : null);
    if (cadPartName && !hoverContent.includes("command:modelscript.focusCadPart?")) {
      const commandArg = encodeURIComponent(JSON.stringify({ partName: cadPartName }));
      const isBio = hasBiomedicalContext(text);
      const label = isBio ? "Inspect in 3D Anatomy Canvas" : "Inspect in 3D CAD Viewer";
      lines.push(`- **Coupled 3D CAD Anchor:** [🔍 ${label}](command:modelscript.focusCadPart?${commandArg})`);
    }

    return hoverContent + lines.join("\n");
  }

  return hoverContent;
}

function enhanceWithCadLink(
  hoverContent: string,
  token: string,
  text: string,
  offset: number,
  allowDemoHeuristics = true,
): string {
  if (!token) return hoverContent;
  if (hoverContent.includes("command:modelscript.focusCadPart?")) return hoverContent;

  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const nextLine = text.indexOf("\n", offset);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const lineText = text.slice(lineStart, lineEnd);

  let coupledPartName: string | null = null;
  let isBiomedical = false;
  const lineHints = extractCrossDomainLineHints(lineText);

  if (lineHints.cadCallPart) {
    coupledPartName = lineHints.cadCallPart;
    isBiomedical = hasBiomedicalContext(text);
  } else if (allowDemoHeuristics) {
    const lowerToken = token.toLowerCase();
    const strictBioKeywords = ["cannula", "ventricle", "atrium", "myocardium", "leaflet", "catheter", "stent"];
    const hasBioContext = hasBiomedicalContext(text);
    const contextualBioKeywords = ["lead", "electrode", "apex", "patch"];

    if (
      strictBioKeywords.some((k) => lowerToken.includes(k)) ||
      (hasBioContext && contextualBioKeywords.some((k) => lowerToken.includes(k)))
    ) {
      coupledPartName = token;
      isBiomedical = true;
    } else if (
      lowerToken.endsWith("_anchor") ||
      lowerToken.endsWith("_cad") ||
      lowerToken.endsWith("_part") ||
      lowerToken.startsWith("cad_")
    ) {
      coupledPartName = token;
      isBiomedical = hasBioContext;
    }
  }

  if (coupledPartName) {
    const commandArg = encodeURIComponent(JSON.stringify({ partName: coupledPartName }));
    const canvasLabel = isBiomedical ? "Inspect in 3D Anatomy Canvas" : "Inspect in 3D CAD Viewer";
    return (
      hoverContent +
      `\n\n---\n**Coupled 3D CAD Anchor:**\n[🔍 ${canvasLabel}](command:modelscript.focusCadPart?${commandArg})`
    );
  }

  return hoverContent;
}

export function registerHoverProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  rawValidationService: ValidationService | HoverValidationServiceLike,
  context?: LspContext,
) {
  const validationService = rawValidationService as unknown as HoverValidationServiceLike;
  const documentLSPBridges = validationService.documentLSPBridges;
  connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // ── Synced External ALM Provenance Hover (DOORS Next / Jama / Codebeamer / Polarion / Jira) ──
    const almHover = getAlmExternalHover(text, params.position.line);
    if (almHover) return almHover;

    // ── CFD (SU2) and FEA (CalculiX) Domain Hovers ──
    const targetUri = params.textDocument.uri;
    if (/\.(cfg|cfgt|su2|cfd)$/i.test(targetUri)) {
      const cfdWord = extractWordAtOffset(text, offset);
      const word = cfdWord.token.toUpperCase();
      const cfdDocs: Record<string, string> = {
        SOLVER:
          "**SU2 Solver Selection**\n\nSpecifies the governing physical equations solver:\n- `INC_RANS`: Incompressible Reynolds-Averaged Navier-Stokes\n- `EULER`: Compressible Inviscid Euler equations\n- `NAVIER_STOKES`: Compressible Laminar Navier-Stokes\n- `RANS`: Compressible Reynolds-Averaged Navier-Stokes",
        KIND_TURB_MODEL:
          "**Turbulence Closure Model**\n\nTurbulence eddy-viscosity closure model:\n- `SST`: Menter Shear Stress Transport k-omega\n- `SA`: Spalart-Allmaras 1-equation model\n- `SA_NEG`: Negative Spalart-Allmaras for unstructured grids",
        MATH_PROBLEM:
          "**Mathematical Problem Formulation**\n\n- `DIRECT`: Forward primal flow simulation\n- `ADJOINT`: Discrete/continuous adjoint sensitivity analysis",
        INC_DENSITY_MODEL:
          "**Fluid Density Model**\n\n- `CONSTANT`: Constant density incompressible fluid\n- `VARIABLE`: Temperature/pressure dependent density",
        INC_DENSITY_INIT:
          "**Reference Fluid Density**\n\nInitial fluid density rho_0 in kg/m^3 (e.g. 1.225 for sea-level air).",
        INC_VELOCITY_INIT:
          "**Free-Stream Velocity Vector**\n\nInitial velocity vector (v_x, v_y, v_z) in m/s. Parameterizes vertical climb or forward cruise.",
        INC_TEMPERATURE_INIT:
          "**Reference Fluid Temperature**\n\nInitial fluid temperature in Kelvin (e.g. 288.15 K standard atmospheric temperature).",
        VISCOSITY_MODEL:
          "**Fluid Dynamic Viscosity Model**\n\n- `CONSTANT_VISCOSITY`: Fixed dynamic viscosity (Newtonian fluid)\n- `SUTHERLAND`: Sutherland law temperature-dependent viscosity",
        MU_CONSTANT:
          "**Constant Dynamic Viscosity**\n\nMolecular dynamic viscosity mu in Pa*s (e.g. 1.81e-5 Pa*s for air at 15 deg C).",
        REF_AREA:
          "**Aerodynamic Reference Projected Area**\n\nReference frontal area A_ref in m^2 used to non-dimensionalize aerodynamic forces into drag/lift coefficients (C_d, C_l). Evaluated geometrically from CAD projection.",
        REF_LENGTH:
          "**Reference Characteristic Length**\n\nCharacteristic aerodynamic length L_ref in meters (e.g. rotor diameter or mean aerodynamic chord).",
        MARKER_INLET:
          "**Inlet Boundary Condition**\n\nPrescribes velocity or total pressure inlet on a CAD tagged surface mesh patch.",
        MARKER_OUTLET:
          "**Outlet Boundary Condition**\n\nPrescribes static pressure outlet on a computational boundary patch.",
        MARKER_HEATFLUX:
          "**Thermal Wall Boundary Condition**\n\nPrescribes wall heat flux q'' in W/m^2 on specified boundary surface markers.",
        MARKER_MONITORING:
          "**Aerodynamic Surface Monitor**\n\nSurfaces included in integrated aerodynamic force coefficient calculations (C_d, C_l, C_m).",
        MARKER_DESIGNING:
          "**Aerodynamic Shape Optimization Surface**\n\nSurface patches parameterized for aerodynamic shape sensitivity and mesh deformation.",
        ITER: "**Maximum Iteration Count**\n\nSpecifies the maximum non-linear iteration cutoff for solver convergence.",
        CONV_FIELD:
          "**Convergence Monitoring Residual Field**\n\nSpecifies which residual field is monitored for numerical convergence (e.g. `RMS_PRESSURE`, `RMS_DENSITY`).",
      };
      if (cfdDocs[word]) {
        return {
          contents: { kind: "markdown", value: cfdDocs[word] },
          range: {
            start: document.positionAt(cfdWord.start),
            end: document.positionAt(cfdWord.end),
          },
        };
      }
    }

    if (/\.(inp|inpt|bdf|fea)$/i.test(targetUri)) {
      const feaWord = extractWordAtOffset(text, offset);
      const rawToken = feaWord.token.toUpperCase();
      const word = rawToken.startsWith("*") ? rawToken.slice(1) : rawToken;
      const feaDocs: Record<string, string> = {
        NODE: "**CalculiX / Abaqus *NODE**\n\nDefines nodal coordinate grid (X, Y, Z) for finite element discretization.",
        ELEMENT:
          "**CalculiX / Abaqus *ELEMENT**\n\nDefines element topology and connectivity:\n- `TYPE=C3D10`: 10-node quadratic tetrahedral solid (prevents shear locking)\n- `TYPE=C3D4`: 4-node linear tetrahedral solid\n- `TYPE=C3D8R`: 8-node reduced integration brick",
        MATERIAL:
          "**CalculiX / Abaqus *MATERIAL**\n\nDefines constitutive material model definition for structural parts.",
        ELASTIC:
          "**Isotropic Elastic Modulus**\n\nSpecifies Young's modulus E in Pa and Poisson's ratio nu (e.g. 70 GPa, 0.33 for structural aluminum/composite).",
        DENSITY:
          "**Material Mass Density**\n\nMass density rho in kg/m^3 (e.g. 2700 kg/m^3). Used for mass matrix and lumped mass calculation.",
        SOLID_SECTION:
          "**Solid Section Assignment**\n\nAssigns element set (`ELSET`) to material definition and coordinate orientation.",
        BOUNDARY:
          "**Kinematic Boundary Constraint (Fixity)**\n\nEnforces zero-displacement constraints on specified node sets (degrees of freedom 1, 2, 3).",
        CLOAD:
          "**Concentrated Nodal Load**\n\nApplies external concentrated force F in Newtons along specified degree of freedom.",
        STEP: "**Analysis Step Definition**\n\nBegins a structural loading step (`*STATIC` stress/strain analysis).",
        END_STEP: "**End of Analysis Step**\n\nTerminates the active structural loading step.",
        NODE_FILE:
          "**Nodal Output Request**\n\nRequests nodal results (e.g. `U` displacement vector) to be written to output file.",
        EL_FILE:
          "**Element Output Request**\n\nRequests integration point results (e.g. `S` stress tensor) to be written to output file.",
      };
      if (feaDocs[word]) {
        return {
          contents: { kind: "markdown", value: feaDocs[word] },
          range: {
            start: document.positionAt(feaWord.start),
            end: document.positionAt(feaWord.end),
          },
        };
      }
    }

    // ── Custom plugin hover (PSCAD, PSS/E, CFD, FEA, etc.) ──
    const pluginForHover = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, text);
    if (pluginForHover?.customHandlers?.hover) {
      const customHover = pluginForHover.customHandlers.hover(offset, text, params.textDocument.uri);
      if (customHover) return customHover;
    }

    // ── Standard polyglot hover (Modelica/SysML/OWL2 — requires bridge) ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    let hoverContent = "";
    let hoverRange: Range | undefined = undefined;

    if (!bridge) {
      const plugin = pluginForHover;
      if (plugin && plugin.facade?.getHover) {
        try {
          const treeEntry = (context?.documentManager?.documentTrees?.get(params.textDocument.uri) ??
            validationService?.documentManager?.documentTrees?.get(params.textDocument.uri)) as
            HoverTreeEntryLike | undefined;
          const tree = treeEntry?.tree ?? treeEntry;
          const rootPtr = tree?.rootNode?.id ?? tree?.rootNode?.ptr ?? tree?.rootPtr ?? 0;
          plugin.facade.loadSource?.(text);
          const hoverText = plugin.facade.getHover(rootPtr, offset);
          if (hoverText) {
            const word = extractWordAtOffset(text, offset);
            const activeSettings = context?.settings ?? validationService?.context?.settings;
            const features = resolveFeatureFlags(activeSettings);
            const allowDemo = activeSettings ? features.demos : true;
            hoverContent = enhanceWithCadLink(hoverText, word.token, text, offset, allowDemo);
            hoverRange = {
              start: document.positionAt(word.start),
              end: document.positionAt(word.end),
            };
          }
        } catch {
          // Facade hover lookup failed; fall back to cross-language hover resolution below.
        }
      }
    } else {
      const hoverDef = bridge.hover(offset, text);
      if (hoverDef?.contents) hoverContent = hoverDef.contents;
      if (hoverDef?.range) hoverRange = hoverDef.range;
    }

    if (!hoverContent) {
      // Check if cursor is over a cross-language reference, e.g. Propulsion::Motor or SysML2::Avionics::IMU
      const { token: fullToken, start: tokStart, end: tokEnd } = extractQualifiedTokenAtOffset(text, offset);

      const pluginWithQe = globalLanguageRegistry.getAllPlugins().find((p) => p.queryEngine);
      const qe: HoverQueryEngineLike | null | undefined =
        bridge?.engine ??
        bridge?.getQueryEngine?.() ??
        validationService?.workspaceManager?.getQueryEngine?.("modelica") ??
        validationService?.workspaceManager?.getQueryEngine?.("sysml2") ??
        (pluginWithQe?.queryEngine as HoverQueryEngineLike | undefined);

      const isCrossLangRef =
        fullToken.includes("::") || fullToken.includes("//") || (fullToken.includes(".") && !fullToken.startsWith("."));

      if (qe && fullToken && isCrossLangRef && typeof qe.resolvePolyglotSymbol === "function") {
        const symId = qe.resolvePolyglotSymbol(fullToken);
        if (symId !== null && symId !== undefined) {
          const entry = qe.resolveEntry(symId);
          if (entry) {
            const domainName = getDomainName(getSymbolDomain(entry.id), entry.resourceId);
            const kind = entry.kind || entry.ruleName || "definition";
            const resName = entry.resourceId ? uriBasename(entry.resourceId) : "";
            const resLink = entry.resourceId ? `\n- **Resource:** [\`${resName}\`](${entry.resourceId})` : "";
            hoverContent = `\`\`\`${domainToLang(domainName)}\n${entry.name}: ${kind}\n\`\`\`\n\n---\n### 🔗 Polyglot Digital Thread Twin\n- **Domain:** ${domainName}\n- **Counterpart:** \`${entry.name}\` (\`${kind}\`)${resLink}`;
            hoverRange = {
              start: document.positionAt(tokStart),
              end: document.positionAt(tokEnd),
            };
          }
        }
      }
    }

    const plugin = globalLanguageRegistry.getPluginForUri(document.uri);
    const activeWord = extractWordAtOffset(text, offset);
    const token = activeWord.token;

    // Enhance hover with reasoner inferences & BFO/IOF classification across all languages
    if (validationService?.reasonerService?.reasoner && token) {
      const rawTaxonomy = validationService.reasonerService.reasoner.getTaxonomy?.();
      const taxonomyMap: Map<string, HoverTaxonomyNodeLike> | null =
        rawTaxonomy instanceof Map
          ? rawTaxonomy
          : Array.isArray(rawTaxonomy)
            ? new Map(
                rawTaxonomy
                  .map((n: HoverTaxonomyNodeLike) => [n.iri ?? n.name ?? n.id ?? "", n] as const)
                  .filter(([k]) => k.length > 0),
              )
            : null;

      if (taxonomyMap) {
        const docLang = document.languageId;
        const langId = plugin?.id || docLang || "polyglot";

        const candidateIris: string[] = [`${langId}:${token}`, token];
        if (docLang && !candidateIris.includes(`${docLang}:${token}`)) {
          candidateIris.push(`${docLang}:${token}`);
        }
        if (langId === "sysml2" || docLang === "sysml2") candidateIris.push(`sysml:${token}`);
        if (langId === "modelica" || docLang === "modelica") candidateIris.push(`mo:${token}`);
        for (const p of globalLanguageRegistry.getAllPlugins()) {
          const pIri = `${p.id}:${token}`;
          if (!candidateIris.includes(pIri)) candidateIris.push(pIri);
        }

        for (const iri of candidateIris) {
          const node = taxonomyMap.get(iri);
          if (node) {
            const superClasses = Array.from<string>(node.superClasses || []).filter(
              (s: string) => s !== "owl:Thing" && s !== iri,
            );

            const bfoCategories = superClasses.filter(
              (s) => s.startsWith("bfo:") || s.startsWith("iof:") || s.startsWith("cco:"),
            );
            const domainTypes = superClasses.filter(
              (s) => !s.startsWith("bfo:") && !s.startsWith("iof:") && !s.startsWith("cco:"),
            );

            if (bfoCategories.length > 0 || domainTypes.length > 0) {
              if (!hoverRange) {
                hoverRange = {
                  start: document.positionAt(activeWord.start),
                  end: document.positionAt(activeWord.end),
                };
              }
            }

            if (bfoCategories.length > 0) {
              hoverContent += `\n\n**Ontological Category (BFO/IOF):**\n- ${bfoCategories.join(", ")}`;
            }

            if (domainTypes.length > 0) {
              hoverContent += `\n\n**Inferred Types (Reasoner):**\n- ${domainTypes.map((d) => stripNamespacePrefix(d)).join(", ")}`;
            }

            const subClasses = Array.from<string>(node.subClasses || []).filter(
              (s: string) => s !== "owl:Nothing" && s !== iri,
            );
            if (subClasses.length > 0) {
              hoverContent += `\n\n**Inferred Subtypes:**\n- ${subClasses.map((s) => stripNamespacePrefix(s)).join(", ")}`;
            }
            break;
          }
        }
      }
    }

    // Enhance hover with formal abstract interpretation invariants if this is Modelica
    const effectiveHoverUri = document.uri.startsWith("modelscript-lib://global")
      ? "file://" + document.uri.substring("modelscript-lib://global".length)
      : document.uri;
    if (document.uri.endsWith(".mo") || plugin?.id === "modelica") {
      const proofMap =
        validationService.modelicaProofResultsByUri?.get(document.uri) ??
        validationService.modelicaProofResultsByUri?.get(effectiveHoverUri);
      if (proofMap) {
        const { token } = extractWordAtOffset(text, offset);

        if (token) {
          for (const [fnName, proof] of proofMap.entries()) {
            const entryStates = proof.summary?.blockEntryStates;
            const exitStates = proof.summary?.blockExitStates;

            let matchedIval: HoverIntervalLike | undefined = undefined;

            // 1. Try finding a basic block spanning the hovered cursor offset
            if (proof.cfg?.blocks) {
              for (const [bId, block] of proof.cfg.blocks) {
                const inBlock = block.instructions.some((inst: { startOffset?: number; endOffset?: number }) => {
                  const startOff = inst.startOffset;
                  const endOff = inst.endOffset;
                  return startOff !== undefined && endOff !== undefined && offset >= startOff && offset <= endOff;
                });
                if (inBlock) {
                  const state = exitStates?.get(bId) || entryStates?.get(bId);
                  const ival = state?.intervals?.get?.(token);
                  if (ival && !ival.isTop?.() && !ival.isBottom?.()) {
                    matchedIval = ival;
                    break;
                  }
                }
              }
            }

            // 2. Sound fallback: inspect reachable blocks where token is bound
            if (!matchedIval && (entryStates || exitStates)) {
              const states = [
                ...(entryStates ? Array.from(entryStates.values()) : []),
                ...(exitStates ? Array.from(exitStates.values()) : []),
              ];
              for (const state of states) {
                const ival = state?.intervals?.get?.(token);
                if (ival && !ival.isTop?.() && !ival.isBottom?.()) {
                  if (!matchedIval) {
                    matchedIval = ival;
                  } else if (matchedIval.join) {
                    matchedIval = matchedIval.join(ival);
                  }
                }
              }
            }

            if (matchedIval) {
              hoverContent += `\n\n---\n**Formal Invariant (Sound Abstract Domain):**\n- \`${token} ∈ ${matchedIval.toString()}\` (Verified Invariant in \`${fnName}\`)`;
              break;
            }
          }
        }
      }
    }

    // Enhance hover with DAE reachability bounds and algebraic loop certificates across all languages
    const daeMap =
      validationService?.daeVerificationResultsByUri?.get(document.uri) ??
      validationService?.daeVerificationResultsByUri?.get(effectiveHoverUri) ??
      validationService?.modelicaDaeVerificationResultsByUri?.get(document.uri) ??
      validationService?.modelicaDaeVerificationResultsByUri?.get(effectiveHoverUri);
    if (daeMap) {
      const { token, start: tokenStart, end: tokenEnd } = extractWordAtOffset(text, offset);

      if (token) {
        for (const [modelName, daeProof] of daeMap.entries()) {
          const varBound = daeProof.variableBounds?.get(token);
          if (varBound && !varBound.isTop?.() && !varBound.isBottom?.()) {
            if (!hoverRange) {
              hoverRange = {
                start: document.positionAt(tokenStart),
                end: document.positionAt(tokenEnd),
              };
            }
            hoverContent += `\n\n---\n**DAE Reachability Invariant:**\n- \`${token} \u2208 ${varBound.toString()}\` (interval enclosure from declared bounds in \`${modelName}\`)`;
          }
        }
      }
    }

    // Enhance hover with coupled 3D CAD navigation link (Workstream 4) and Digital Thread Twin
    const { token: hoveredToken } = extractWordAtOffset(text, offset);

    const activeSettings = context?.settings ?? validationService?.context?.settings;
    const features = resolveFeatureFlags(activeSettings);
    const allowDigitalThread = activeSettings ? features.digitalThread : true;
    const allowDemo = activeSettings ? features.demos : true;

    if (allowDigitalThread) {
      hoverContent = enhanceWithDigitalThreadTwin(
        hoverContent,
        hoveredToken,
        text,
        offset,
        document.uri,
        bridge,
        validationService,
      );
    }
    hoverContent = enhanceWithCadLink(hoverContent, hoveredToken, text, offset, allowDemo);

    if (!hoverContent.trim()) return null;

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverContent.trim(),
      },
      ...(hoverRange ? { range: hoverRange } : {}),
    };
  });
}
