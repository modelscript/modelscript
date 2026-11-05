// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — NIST OSCAL Authorization Boundary, CPS Security Zones & Control Matrix Diagram Builder.
 *
 * Provides vector visualizations and interactive AntV X6 graph models for NIST SP 800-53 / SP 800-82 and Continuous ATO workflows:
 *   1. Authorization Boundary & IEC 62443 / SP 800-82 Cyber-Physical Security Zones & Conduits.
 *   2. NIST SP 800-53 Control Family Coverage & Risk Heatmap.
 *   3. Interactive AntV X6 graph model with ports and conduits for Ansatz Sketch.
 */

export interface OscalComponentLike {
  uuid: string;
  title: string;
  type: string;
  status?: string | undefined;
  zone?: "Enterprise" | "DMZ" | "Supervisory" | "Field-OT" | string | undefined;
  implementedControls?: string[] | undefined;
}

export interface OscalImplementedRequirementLike {
  uuid?: string | undefined;
  controlId: string;
  statements?: { statementId?: string | undefined; description?: string | undefined }[] | undefined;
  byComponents?: { componentUuid: string; description?: string | undefined }[] | undefined;
}

export interface OscalFindingLike {
  uuid: string;
  title: string;
  targetControlId?: string | undefined;
  targetComponentUuid?: string | undefined;
  severity: "low" | "moderate" | "high" | "critical";
  status: "open" | "satisfied";
}

export interface OscalPoamItemLike {
  uuid: string;
  title: string;
  targetControlId?: string | undefined;
  relatedFindingUuid?: string | undefined;
  status?: string | undefined;
}

export interface OscalControlLike {
  id: string;
  title?: string | undefined;
  class?: string | undefined;
}

export interface OscalGroupLike {
  id?: string | undefined;
  title?: string | undefined;
  controls?: OscalControlLike[] | undefined;
}

export interface OscalDocumentLike {
  kind: string;
  uuid: string;
  title?: string | undefined;
  systemName?: string | undefined;
  securitySensitivityLevel?: string | undefined;
  components?: OscalComponentLike[] | undefined;
  systemImplementation?: { components?: OscalComponentLike[] } | undefined;
  implementedRequirements?: OscalImplementedRequirementLike[] | undefined;
  controlImplementation?: { implementedRequirements?: OscalImplementedRequirementLike[] } | undefined;
  findings?: OscalFindingLike[] | undefined;
  poamItems?: OscalPoamItemLike[] | undefined;
  groups?: OscalGroupLike[] | undefined;
  controls?: OscalControlLike[] | undefined;
  metadata?: { title?: string; version?: string } | undefined;
}

export interface OscalDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  parent?: string | undefined;
  children?: string[] | undefined;
  zIndex?: number | undefined;
  ports?: unknown;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  data?: Record<string, unknown> | undefined;
  labels?: Array<{
    attrs?: {
      text?: { text?: string; fill?: string; fontSize?: number; fontWeight?: string | number };
      rect?: { fill?: string; stroke?: string; rx?: number; ry?: number };
    };
    position?: number;
  }>;
}

export interface OscalDiagramGraph {
  title: string;
  cells: OscalDiagramCell[];
  nodes: OscalDiagramCell[];
  edges: OscalDiagramCell[];
  metadata: {
    title?: string | undefined;
    kind: string;
    componentCount: number;
    conduitCount: number;
    zoneCount: number;
    implementedControlCount: number;
    findingCount: number;
    readOnly?: boolean | undefined;
  };
}

export interface OscalDiagramOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function classifyZone(comp: OscalComponentLike): "Enterprise" | "DMZ" | "Supervisory" | "Field-OT" {
  if (comp.zone === "Enterprise" || comp.zone === "DMZ" || comp.zone === "Supervisory" || comp.zone === "Field-OT") {
    return comp.zone;
  }
  const t = comp.type.toLowerCase();
  const title = comp.title.toLowerCase();
  if (
    t === "plc" ||
    t === "ied" ||
    t === "ot-controller" ||
    title.includes("plc") ||
    title.includes("actuator") ||
    title.includes("sensor")
  ) {
    return "Field-OT";
  }
  if (title.includes("scada") || title.includes("hmi") || title.includes("historian") || t === "hardware") {
    return "Supervisory";
  }
  if (title.includes("firewall") || title.includes("gateway") || title.includes("broker") || t === "interconnection") {
    return "DMZ";
  }
  return "Enterprise";
}

const PURDUE_ZONES: {
  id: "Enterprise" | "DMZ" | "Supervisory" | "Field-OT";
  label: string;
  sub: string;
  color: string;
}[] = [
  {
    id: "Enterprise",
    label: "Level 4: Enterprise & Cloud IT Zone",
    sub: "NIST SP 800-53 Baseline",
    color: "#3b82f6",
  },
  {
    id: "DMZ",
    label: "Level 3.5: Industrial DMZ & Boundary Protection",
    sub: "SC-7 Boundary / Data Diode",
    color: "#a855f7",
  },
  {
    id: "Supervisory",
    label: "Level 2/3: Supervisory SCADA / HMI / Historian",
    sub: "AU-2 / SI-4 Monitoring",
    color: "#eab308",
  },
  {
    id: "Field-OT",
    label: "Level 0/1: Cyber-Physical Field Controllers (PLC / IED / RTU)",
    sub: "NIST SP 800-82 OT Overlay",
    color: "#10b981",
  },
];

/**
 * Builds an interactive AntV X6 graph model for an OSCAL document.
 *
 * For System Security Plans (SSP) and component definitions:
 *   - Lays out the System Authorization Boundary and Purdue Model Security Zones.
 *   - Creates interactive Component nodes with ports, type tags, and control badges.
 *   - Synthesizes Conduits (directed network links) across zone boundaries and interconnections.
 *
 * For Catalogs and Profiles:
 *   - Lays out NIST SP 800-53 Control Families with control tallies and family relationships.
 */
export function buildOscalDiagram(doc: OscalDocumentLike, options?: OscalDiagramOptions): OscalDiagramGraph {
  const isDark = options?.theme !== "light";
  const title =
    doc.title?.trim() ||
    doc.systemName?.trim() ||
    doc.metadata?.title?.trim() ||
    (doc.kind === "catalog"
      ? "NIST SP 800-53 Control Catalog"
      : doc.kind === "profile"
        ? "NIST Security Baseline Profile"
        : "NIST OSCAL Authorization Boundary & Zones");

  const components = doc.systemImplementation?.components ?? doc.components ?? [];
  const implementedReqs = doc.controlImplementation?.implementedRequirements ?? doc.implementedRequirements ?? [];
  const findings = doc.findings ?? [];

  const isCatalogOrProfile = (doc.kind === "catalog" || doc.kind === "profile") && components.length === 0;

  if (isCatalogOrProfile) {
    return buildOscalCatalogDiagram(doc, title, isDark);
  }

  const nodes: OscalDiagramCell[] = [];
  const edges: OscalDiagramCell[] = [];

  // Map controls per component
  const controlsByComp = new Map<string, string[]>();
  for (const req of implementedReqs) {
    for (const bc of req.byComponents ?? []) {
      const list = controlsByComp.get(bc.componentUuid) ?? [];
      const cUpper = req.controlId.toUpperCase();
      if (!list.includes(cUpper)) {
        list.push(cUpper);
      }
      controlsByComp.set(bc.componentUuid, list);
    }
  }

  // Map open findings per component
  const openFindingsByComp = new Map<string, OscalFindingLike[]>();
  for (const f of findings) {
    if (f.status === "open" && f.targetComponentUuid) {
      const list = openFindingsByComp.get(f.targetComponentUuid) ?? [];
      list.push(f);
      openFindingsByComp.set(f.targetComponentUuid, list);
    }
  }

  // Classify components into Purdue zones
  const compsByZone = new Map<string, OscalComponentLike[]>();
  for (const z of PURDUE_ZONES) compsByZone.set(z.id, []);
  for (const c of components) {
    const z = classifyZone(c);
    compsByZone.get(z)?.push(c);
  }

  const rowCols = 3;
  let currentY = 74;
  const compCellsByZone = new Map<string, OscalDiagramCell[]>();

  for (const z of PURDUE_ZONES) {
    const zComps = compsByZone.get(z.id) ?? [];
    const numRows = Math.max(1, Math.ceil(zComps.length / rowCols));
    const zHeight = Math.max(90, 20 + numRows * 78);

    // Zone Container node
    const zoneCell: OscalDiagramCell = {
      id: `zone_${z.id}`,
      shape: "rect",
      x: 34,
      y: currentY,
      width: 880,
      height: zHeight,
      zIndex: 1,
      attrs: {
        body: {
          fill: isDark ? "#0f172a" : "#f8fafc",
          fillOpacity: 0.85,
          stroke: z.color,
          strokeWidth: 1.5,
          rx: 6,
          ry: 6,
        },
        label: {
          text: `${z.label}\n${z.sub}`,
          fill: z.color,
          fontSize: 11,
          fontWeight: 700,
          textAnchor: "start",
          refX: 14,
          refY: 22,
        },
      },
      data: { zoneId: z.id, isZoneContainer: true },
    };
    nodes.push(zoneCell);

    const createdCompCells: OscalDiagramCell[] = [];

    if (zComps.length === 0) {
      nodes.push({
        id: `empty_${z.id}`,
        shape: "rect",
        x: 300,
        y: currentY + 34,
        width: 320,
        height: 28,
        zIndex: 2,
        attrs: {
          body: { fill: "transparent", stroke: "none" },
          label: {
            text: `No components allocated to ${z.id} zone`,
            fill: isDark ? "#64748b" : "#94a3b8",
            fontSize: 11,
            fontStyle: "italic",
          },
        },
        data: { isPlaceholder: true },
      });
    } else {
      zComps.forEach((comp, idx) => {
        const col = idx % rowCols;
        const row = Math.floor(idx / rowCols);
        const cx = 280 + col * 200;
        const cy = currentY + 12 + row * 76;
        const cw = 188;
        const ch = 64;

        const compFindings = openFindingsByComp.get(comp.uuid) ?? [];
        const hasHighRisk = compFindings.some((f) => f.severity === "high" || f.severity === "critical");
        const borderCol = hasHighRisk ? "#ef4444" : compFindings.length > 0 ? "#f59e0b" : z.color;

        const ctrls = comp.implementedControls ?? controlsByComp.get(comp.uuid) ?? [];
        const badgeText = ctrls.length > 0 ? ctrls.slice(0, 4).join(", ") : "No Controls";

        const compNode: OscalDiagramCell = {
          id: comp.uuid || `comp_${comp.title}`,
          shape: "rect",
          x: cx,
          y: cy,
          width: cw,
          height: ch,
          zIndex: 10,
          ports: {
            groups: {
              in: {
                position: "left",
                attrs: {
                  circle: {
                    r: 4,
                    magnet: true,
                    stroke: borderCol,
                    fill: isDark ? "#0f172a" : "#ffffff",
                    strokeWidth: 1.5,
                  },
                },
              },
              out: {
                position: "right",
                attrs: {
                  circle: {
                    r: 4,
                    magnet: true,
                    stroke: borderCol,
                    fill: isDark ? "#0f172a" : "#ffffff",
                    strokeWidth: 1.5,
                  },
                },
              },
            },
            items: [
              { id: "in", group: "in" },
              { id: "out", group: "out" },
            ],
          },
          attrs: {
            body: {
              fill: isDark ? "#1e293b" : "#ffffff",
              stroke: borderCol,
              strokeWidth: hasHighRisk ? 2.2 : 1.5,
              rx: 5,
              ry: 5,
            },
            label: {
              text: `${comp.title.slice(0, 24)}\nType: ${comp.type.toUpperCase()}\n${badgeText}`,
              fill: isDark ? "#f8fafc" : "#0f172a",
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 14,
            },
          },
          data: {
            uuid: comp.uuid,
            title: comp.title,
            type: comp.type,
            zone: z.id,
            controls: ctrls,
            findingsCount: compFindings.length,
            severity: hasHighRisk ? "high" : compFindings.length > 0 ? "warning" : "compliant",
          },
        };

        nodes.push(compNode);
        createdCompCells.push(compNode);
      });
    }

    compCellsByZone.set(z.id, createdCompCells);
    currentY += zHeight + 14;
  }

  const totalHeight = Math.max(500, currentY + 16);

  // Outer System Authorization Boundary (ATO) node
  const atoBoundaryNode: OscalDiagramCell = {
    id: "boundary_ato",
    shape: "rect",
    x: 18,
    y: 52,
    width: 912,
    height: totalHeight - 68,
    zIndex: 0,
    attrs: {
      body: {
        fill: isDark ? "#1e293b" : "#f1f5f9",
        fillOpacity: 0.12,
        stroke: "#f43f5e",
        strokeWidth: 2,
        strokeDasharray: "8,5",
        rx: 8,
        ry: 8,
      },
      label: {
        text: `SYSTEM AUTHORIZATION BOUNDARY (ATO) — FIPS-199: ${(doc.securitySensitivityLevel ?? "MODERATE").toUpperCase()}`,
        fill: "#f43f5e",
        fontSize: 10,
        fontWeight: 700,
        textAnchor: "start",
        refX: 20,
        refY: 15,
      },
    },
    data: { isAtoBoundary: true },
  };
  nodes.unshift(atoBoundaryNode);

  // Synthesize Conduits (Network Interconnections) across zones
  const enterpriseComps = compCellsByZone.get("Enterprise") ?? [];
  const dmzComps = compCellsByZone.get("DMZ") ?? [];
  const supervisoryComps = compCellsByZone.get("Supervisory") ?? [];
  const fieldComps = compCellsByZone.get("Field-OT") ?? [];

  // Find DMZ Interconnection gateway (e.g. firewall, data diode)
  const dmzGateway =
    dmzComps.find(
      (c) =>
        c.data?.["type"] === "interconnection" ||
        String(c.data?.["title"] ?? "")
          .toLowerCase()
          .includes("firewall") ||
        String(c.data?.["title"] ?? "")
          .toLowerCase()
          .includes("gateway"),
    ) ?? dmzComps[0];

  let conduitCounter = 0;
  const makeConduitEdge = (
    src: OscalDiagramCell,
    tgt: OscalDiagramCell,
    labelText: string,
    color = "#38bdf8",
  ): OscalDiagramCell => {
    conduitCounter++;
    return {
      id: `conduit_${src.id}_${tgt.id}_${conduitCounter}`,
      shape: "edge",
      zIndex: 5,
      source: { cell: src.id, port: "out" },
      target: { cell: tgt.id, port: "in" },
      router: { name: "manhattan" },
      attrs: {
        line: {
          stroke: color,
          strokeWidth: 1.8,
          targetMarker: {
            name: "block",
            width: 6,
            height: 6,
            fill: color,
          },
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: labelText,
              fill: isDark ? "#38bdf8" : "#0284c7",
              fontSize: 9,
              fontWeight: 600,
            },
            rect: {
              fill: isDark ? "#0f172a" : "#ffffff",
              stroke: isDark ? "#334155" : "#cbd5e1",
              rx: 3,
              ry: 3,
            },
          },
          position: 0.5,
        },
      ],
      data: { isConduit: true, label: labelText },
    };
  };

  // 1. Enterprise to DMZ conduit
  if (dmzGateway) {
    if (enterpriseComps.length > 0) {
      enterpriseComps.forEach((entComp) => {
        edges.push(makeConduitEdge(entComp, dmzGateway, "SC-7 DMZ Boundary", "#38bdf8"));
      });
    }

    // 2. DMZ Gateway to Supervisory SCADA/Historian
    if (supervisoryComps.length > 0) {
      supervisoryComps.forEach((supComp) => {
        edges.push(makeConduitEdge(dmzGateway, supComp, "IEC 62443 Conduit", "#a855f7"));
      });
    }
  } else if (enterpriseComps.length > 0 && supervisoryComps.length > 0) {
    edges.push(makeConduitEdge(enterpriseComps[0]!, supervisoryComps[0]!, "Supervisory Conduit", "#38bdf8"));
  }

  // 3. Supervisory to Field-OT PLC/Controller conduit
  if (supervisoryComps.length > 0 && fieldComps.length > 0) {
    const primarySup = supervisoryComps[0]!;
    fieldComps.forEach((fieldComp) => {
      edges.push(makeConduitEdge(primarySup, fieldComp, "OPC-UA / OT Fieldbus", "#10b981"));
    });
  }

  const cells = [...nodes, ...edges];

  return {
    title,
    cells,
    nodes,
    edges,
    metadata: {
      title,
      kind: doc.kind || "system-security-plan",
      componentCount: components.length,
      conduitCount: edges.length,
      zoneCount: PURDUE_ZONES.length,
      implementedControlCount: implementedReqs.length,
      findingCount: findings.length,
      readOnly: true,
    },
  };
}

/**
 * Builds an interactive AntV X6 graph model for an OSCAL Catalog or Profile document.
 */
function buildOscalCatalogDiagram(doc: OscalDocumentLike, title: string, isDark: boolean): OscalDiagramGraph {
  const nodes: OscalDiagramCell[] = [];
  const edges: OscalDiagramCell[] = [];

  const families = [
    { id: "AC", name: "Access Control", color: "#3b82f6" },
    { id: "AU", name: "Audit & Accountability", color: "#6366f1" },
    { id: "CM", name: "Config Management", color: "#8b5cf6" },
    { id: "CP", name: "Contingency Planning", color: "#ec4899" },
    { id: "IA", name: "Ident & Authentication", color: "#06b6d4" },
    { id: "IR", name: "Incident Response", color: "#f43f5e" },
    { id: "PE", name: "Physical Protection", color: "#10b981" },
    { id: "RA", name: "Risk Assessment", color: "#f59e0b" },
    { id: "SC", name: "Sys & Communications", color: "#0ea5e9" },
    { id: "SI", name: "System Integrity", color: "#14b8a6" },
    { id: "SR", name: "Supply Chain Risk", color: "#d946ef" },
  ];

  const controls = doc.controls ?? [];
  const groups = doc.groups ?? [];
  const allControls = [...controls, ...groups.flatMap((g) => g.controls ?? [])];

  const controlCounts = new Map<string, number>();
  for (const c of allControls) {
    const p = c.id.slice(0, 2).toUpperCase();
    controlCounts.set(p, (controlCounts.get(p) ?? 0) + 1);
  }

  const cols = 4;
  families.forEach((fam, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 50 + col * 215;
    const y = 60 + row * 110;
    const w = 195;
    const h = 88;

    const count = controlCounts.get(fam.id) ?? (doc.kind === "catalog" ? 18 : 6);

    nodes.push({
      id: `fam_${fam.id}`,
      shape: "rect",
      x,
      y,
      width: w,
      height: h,
      zIndex: 5,
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: fam.color, fill: isDark ? "#0f172a" : "#ffffff" },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: fam.color, fill: isDark ? "#0f172a" : "#ffffff" },
            },
          },
        },
        items: [
          { id: "in", group: "in" },
          { id: "out", group: "out" },
        ],
      },
      attrs: {
        body: {
          fill: isDark ? "#1e293b" : "#ffffff",
          stroke: fam.color,
          strokeWidth: 1.6,
          rx: 6,
          ry: 6,
        },
        label: {
          text: `[${fam.id}] ${fam.name}\n${count} Controls Allocated`,
          fill: isDark ? "#f8fafc" : "#0f172a",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 16,
        },
      },
      data: { familyId: fam.id, name: fam.name, count },
    });
  });

  // Link foundational control families
  const links = [
    { from: "fam_IA", to: "fam_AC", label: "Auth -> Access" },
    { from: "fam_AU", to: "fam_SI", label: "Audit -> Integrity" },
    { from: "fam_CM", to: "fam_SC", label: "Config -> Comm" },
  ];

  links.forEach((link, idx) => {
    edges.push({
      id: `edge_fam_${idx}`,
      shape: "edge",
      zIndex: 2,
      source: { cell: link.from, port: "out" },
      target: { cell: link.to, port: "in" },
      router: { name: "manhattan" },
      attrs: {
        line: {
          stroke: "#64748b",
          strokeWidth: 1.5,
          strokeDasharray: "4,4",
          targetMarker: { name: "block", width: 5, height: 5, fill: "#64748b" },
        },
      },
      labels: [
        {
          attrs: {
            text: { text: link.label, fill: "#94a3b8", fontSize: 9 },
            rect: { fill: isDark ? "#0f172a" : "#ffffff", rx: 2, ry: 2 },
          },
          position: 0.5,
        },
      ],
    });
  });

  const cells = [...nodes, ...edges];
  return {
    title,
    cells,
    nodes,
    edges,
    metadata: {
      title,
      kind: doc.kind,
      componentCount: 0,
      conduitCount: edges.length,
      zoneCount: families.length,
      implementedControlCount: allControls.length,
      findingCount: 0,
      readOnly: true,
    },
  };
}

/**
 * Renders the NIST SP 800-53 / SP 800-82 System Authorization Boundary and Security Zone/Conduit Architecture.
 *
 * Dynamically wraps components into multi-row grid layouts with dynamic SVG height
 * to ensure all components across all Purdue zones are fully visible without truncation.
 */
export function renderOscalBoundarySvg(doc: OscalDocumentLike): string {
  const width = 920;
  const parts: string[] = [];

  // Map controls and open findings per component
  const controlsByComp = new Map<string, string[]>();
  for (const req of doc.implementedRequirements ?? []) {
    for (const bc of req.byComponents ?? []) {
      const list = controlsByComp.get(bc.componentUuid) ?? [];
      const cUpper = req.controlId.toUpperCase();
      if (!list.includes(cUpper)) {
        list.push(cUpper);
      }
      controlsByComp.set(bc.componentUuid, list);
    }
  }

  const openFindingsByComp = new Map<string, OscalFindingLike[]>();
  for (const f of doc.findings ?? []) {
    if (f.status === "open" && f.targetComponentUuid) {
      const list = openFindingsByComp.get(f.targetComponentUuid) ?? [];
      list.push(f);
      openFindingsByComp.set(f.targetComponentUuid, list);
    }
  }

  const components = doc.systemImplementation?.components ?? doc.components ?? [];
  const compsByZone = new Map<string, OscalComponentLike[]>();
  for (const z of PURDUE_ZONES) compsByZone.set(z.id, []);
  for (const c of components) {
    const z = classifyZone(c);
    compsByZone.get(z)?.push(c);
  }

  // Calculate dynamic heights per zone to prevent clipping components > 3
  const rowCols = 3;
  let currentZoneY = 72;
  const zoneLayouts = PURDUE_ZONES.map((z) => {
    const zComps = compsByZone.get(z.id) ?? [];
    const numRows = Math.max(1, Math.ceil(zComps.length / rowCols));
    const zHeight = Math.max(86, 20 + numRows * 76);
    const y = currentZoneY;
    currentZoneY += zHeight + 14;
    return { ...z, y, height: zHeight, comps: zComps };
  });

  const totalHeight = Math.max(500, currentZoneY + 16);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="40" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">NIST OSCAL Authorization Boundary &amp; SP 800-82 Cyber-Physical Security Zones</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">FIPS-199 Impact: ${escapeXml((doc.securitySensitivityLevel ?? "MODERATE").toUpperCase())}</text>`,
  );

  // Dashed Authorization Boundary Enclosure
  parts.push(
    `<rect x="18" y="52" width="${width - 36}" height="${totalHeight - 72}" rx="8" fill="#1e293b" fill-opacity="0.22" stroke="#f43f5e" stroke-width="2" stroke-dasharray="8,5"/>`,
  );
  parts.push(
    `<rect x="34" y="43" width="250" height="18" rx="4" fill="#f43f5e"/><text x="159" y="56" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle">SYSTEM AUTHORIZATION BOUNDARY (ATO)</text>`,
  );

  for (const z of zoneLayouts) {
    parts.push(
      `<rect x="34" y="${z.y}" width="${width - 68}" height="${z.height}" rx="6" fill="#0f172a" fill-opacity="0.75" stroke="${z.color}" stroke-width="1.3"/>`,
    );
    parts.push(
      `<rect x="34" y="${z.y}" width="230" height="${z.height}" rx="6" fill="${z.color}" fill-opacity="0.14"/>`,
    );
    parts.push(
      `<text x="46" y="${z.y + 34}" fill="#f8fafc" font-size="11.5" font-weight="700">${escapeXml(z.label)}</text>`,
    );
    parts.push(
      `<text x="46" y="${z.y + 54}" fill="${z.color}" font-size="10.5" font-weight="600">${escapeXml(z.sub)}</text>`,
    );

    if (z.comps.length === 0) {
      parts.push(
        `<text x="310" y="${z.y + 47}" fill="#64748b" font-size="11" font-style="italic">No components allocated to ${z.id} zone</text>`,
      );
    } else {
      z.comps.forEach((comp, idx) => {
        const col = idx % rowCols;
        const row = Math.floor(idx / rowCols);
        const cx = 280 + col * 198;
        const cy = z.y + 11 + row * 76;
        const cw = 186;
        const ch = 64;

        const findings = openFindingsByComp.get(comp.uuid) ?? [];
        const hasHighRisk = findings.some((f) => f.severity === "high" || f.severity === "critical");
        const borderCol = hasHighRisk ? "#ef4444" : findings.length > 0 ? "#f59e0b" : z.color;

        parts.push(
          `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="5" fill="#1e293b" stroke="${borderCol}" stroke-width="${hasHighRisk ? 2.2 : 1.5}"/>`,
        );
        parts.push(
          `<text x="${cx + 10}" y="${cy + 19}" fill="#f8fafc" font-size="11" font-weight="600">${escapeXml(comp.title.slice(0, 22))}</text>`,
        );
        parts.push(
          `<text x="${cx + 10}" y="${cy + 34}" fill="#94a3b8" font-size="9.5">Type: ${escapeXml(comp.type.toUpperCase())}</text>`,
        );

        const ctrls = comp.implementedControls ?? controlsByComp.get(comp.uuid) ?? [];
        const badgeText = ctrls.length > 0 ? ctrls.slice(0, 4).join(", ") : "No Controls";
        parts.push(
          `<rect x="${cx + 8}" y="${cy + 41}" width="${cw - 16}" height="17" rx="3" fill="#0f172a" stroke="#334155"/>`,
        );
        parts.push(
          `<text x="${cx + 14}" y="${cy + 53}" fill="#38bdf8" font-size="9.5" font-weight="600">${escapeXml(badgeText)}</text>`,
        );

        if (findings.length > 0) {
          parts.push(
            `<circle cx="${cx + cw - 12}" cy="${cy + 14}" r="7" fill="${borderCol}"/><text x="${cx + cw - 12}" y="${cy + 18}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">!</text>`,
          );
        }
      });
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders the NIST SP 800-53 Control Family Coverage & Open Finding Heatmap.
 */
export function renderOscalControlMatrixSvg(doc: OscalDocumentLike): string {
  const width = 880;
  const height = 270;
  const families = [
    { id: "AC", name: "Access Control" },
    { id: "AU", name: "Audit" },
    { id: "CM", name: "Config Mgmt" },
    { id: "CP", name: "Contingency" },
    { id: "IA", name: "Ident & Auth" },
    { id: "IR", name: "Incident Resp" },
    { id: "PE", name: "Physical / OT" },
    { id: "RA", name: "Risk Assess" },
    { id: "SC", name: "Sys & Comm" },
    { id: "SI", name: "Sys Integrity" },
    { id: "SR", name: "Supply Chain" },
  ];

  const reqCounts = new Map<string, number>();
  for (const r of doc.implementedRequirements ?? []) {
    const prefix = r.controlId.slice(0, 2).toUpperCase();
    reqCounts.set(prefix, (reqCounts.get(prefix) ?? 0) + 1);
  }

  const findingCounts = new Map<string, number>();
  for (const f of doc.findings ?? []) {
    if (f.status === "open" && f.targetControlId) {
      const prefix = f.targetControlId.slice(0, 2).toUpperCase();
      findingCounts.set(prefix, (findingCounts.get(prefix) ?? 0) + 1);
    }
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="36" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="23" fill="#f8fafc" font-size="13" font-weight="600">NIST SP 800-53 Rev 5 Control Family Implementation &amp; POA&amp;M Risk Posture</text>`,
  );

  const cellW = 74;
  const startX = 24;
  const startY = 56;

  families.forEach((fam, idx) => {
    const x = startX + idx * (cellW + 3);
    const implCount = reqCounts.get(fam.id) ?? 0;
    const openRisk = findingCounts.get(fam.id) ?? 0;
    const cardColor = openRisk > 0 ? "#ef4444" : implCount > 0 ? "#22c55e" : "#475569";

    parts.push(
      `<rect x="${x}" y="${startY}" width="${cellW}" height="180" rx="5" fill="#1e293b" stroke="${cardColor}" stroke-width="1.6"/>`,
    );
    parts.push(
      `<rect x="${x}" y="${startY}" width="${cellW}" height="32" rx="5" fill="${cardColor}" fill-opacity="0.25"/>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 21}" fill="#f8fafc" font-size="13" font-weight="700" text-anchor="middle">${fam.id}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 52}" fill="#94a3b8" font-size="9.5" text-anchor="middle">${escapeXml(fam.name)}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 98}" fill="#38bdf8" font-size="22" font-weight="700" text-anchor="middle">${implCount}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 116}" fill="#64748b" font-size="9.5" text-anchor="middle">Controls</text>`,
    );

    const riskBadgeCol = openRisk > 0 ? "#ef4444" : "#22c55e";
    parts.push(
      `<rect x="${x + 8}" y="${startY + 142}" width="${cellW - 16}" height="22" rx="4" fill="${riskBadgeCol}" fill-opacity="0.2" stroke="${riskBadgeCol}"/>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 157}" fill="${riskBadgeCol}" font-size="9.5" font-weight="700" text-anchor="middle">${openRisk > 0 ? `${openRisk} Finding` : "Compliant"}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
