<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { LANGUAGE_COUNT } from "../data/languages";
import lintRules from "../data/lint-rules.generated.json";
import mcpData from "../data/mcp-tools.generated.json";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const totalRules = (
  Array.isArray(lintRules)
    ? lintRules.reduce((acc, l) => acc + (l.rules?.length || 0), 0)
    : (lintRules as any)?.totalRules ?? 0
).toLocaleString();
const totalLangs = Array.isArray(lintRules) ? lintRules.length : ((lintRules as any)?.totalLanguages ?? LANGUAGE_COUNT);

const columns: MegaMenuColumn[] = [
  {
    id: "getting-started",
    label: "Getting Started & Guides",
    items: [
      {
        name: "Introduction",
        tagline: "What the computable digital thread is and how it works",
        href: "/guide/introduction",
        icon: "globe",
        accent: "#22d3ee",
      },
      {
        name: "Installation",
        tagline: "Install the CLI, VS Code extension, Docker image, or SDK",
        href: "/guide/installation",
        icon: "download",
        accent: "#34d399",
      },
      {
        name: "Getting Started",
        tagline: "Build, simulate, and verify your first multi-domain model",
        href: "/guide/getting-started",
        icon: "play",
        accent: "#38bdf8",
      },
      {
        name: "AI Agents & MCP Workflows",
        tagline: "Configure Claude, Cursor & closed-loop synthesis pipelines",
        href: "/guide/ai-agents",
        icon: "sparkles",
        accent: "#a78bfa",
      },
      {
        name: "CI/CD & GitHub Actions",
        tagline: "Automate linting, formal verification & SARIF code scanning",
        href: "/guide/ci-cd",
        icon: "git",
        accent: "#fbbf24",
      },
      {
        name: "Enterprise Administration",
        tagline: "Air-gapped deployment, RBAC, SSO, billing & audit logs",
        href: "/guide/administration",
        icon: "shield",
        accent: "#818cf8",
      },
    ],
  },
  {
    id: "languages",
    label: `Polyglot Languages (${totalLangs} Formats)`,
    items: [
      {
        name: "Overview & Matrix",
        tagline: `Interactive matrix across all ${totalLangs} simulation & CAE formats`,
        href: "/languages/overview",
        icon: "grid",
        accent: "#22d3ee",
      },
      {
        name: "Modelica (.mo)",
        tagline: "Acausal multi-domain physical systems & MSL 4.x · Stable",
        href: "/languages/modelica",
        icon: "activity",
        accent: "#818cf8",
      },
      {
        name: "SysML v2, ReqIF & OSCAL",
        tagline: "Systems architecture, KerML, requirements & NIST OSCAL",
        href: "/languages/sysml2",
        icon: "workflow",
        accent: "#38bdf8",
      },
      {
        name: "Simulink & SSP / FMI",
        tagline: "Block diagrams, state machines & FMU system packaging",
        href: "/languages/simulink",
        icon: "box",
        accent: "#34d399",
      },
      {
        name: "STEP CAD, QIF & OpenSCAD",
        tagline: "ISO 10303 AP242 B-Rep, QIF metrology & CSG solids",
        href: "/languages/step",
        icon: "cube",
        accent: "#2dd4bf",
      },
      {
        name: "Power Systems & EMT",
        tagline: "PSCAD EMT, Siemens PSS/E, OpenDSS & SPICE netlists",
        href: "/languages/pscad",
        icon: "zap",
        accent: "#facc15",
      },
    ],
  },
  {
    id: "toolchain-reference",
    label: "Toolchain & Reference",
    items: [
      {
        name: "CLI Command Reference",
        tagline: "Complete reference for all msx commands, actions & flags",
        href: "/cli/commands",
        icon: "terminal",
        accent: "#34d399",
      },
      {
        name: "Compiler Linter Rules",
        tagline: `Searchable catalog of ${totalRules} static diagnostics across ${totalLangs} formats`,
        href: "/reference/linter-rules",
        icon: "check",
        accent: "#22d3ee",
      },
      {
        name: "Radiology & Surgical CAS",
        tagline: "DICOM-RT, TOPAS, NIfTI/NRRD, 3MF Medical & OpenIGTLink",
        href: "/reference/radiology-and-surgery",
        icon: "activity",
        accent: "#fb7185",
      },
      {
        name: "Standards & Export Formats",
        tagline: "FMI 2.0/3.0, SSP, STEP AP242, SARIF, COMTRADE & ReqIF",
        href: "/reference/export-formats",
        icon: "upload",
        accent: "#38bdf8",
      },
      {
        name: "MCP & IDE Reference",
        tagline: `All ${mcpData.toolCount} MCP tool schemas, LSP capabilities & DAP debugger`,
        href: "/reference/mcp-and-ide",
        icon: "layers",
        accent: "#a78bfa",
      },
      {
        name: "Pricing & Licensing",
        tagline: "Commercial SDK, enterprise appliances & open-core tiers",
        href: "/pricing",
        icon: "shield",
        accent: "#34d399",
      },
    ],
  },
];

const feature: MegaMenuFeature = {
  eyebrow: `Polyglot Compiler Matrix (${totalLangs} Formats)`,
  title: "Simulate & verify from the CLI",
  body: `Flatten hierarchical models, run stiff DAE solvers, and emit SARIF verification proofs across ${totalLangs} formats.`,
  code: "msx simulate BouncingBall model.mo --stop-time 5",
  ctaLabel: `Browse all ${totalLangs} languages`,
  ctaHref: "/languages/overview",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: "Documentation Home", href: "/guide/introduction", icon: "globe" },
  { label: `All ${totalLangs} Languages Matrix`, href: "/languages/overview", icon: "grid" },
  { label: "Compiler Architecture", href: "/architecture/overview", icon: "cpu" },
  { label: "Algorithms Catalog", href: "/algorithms/overview", icon: "activity" },
  {
    label: "PDF Reference Manual",
    href: "/modelscript-reference-manual.pdf",
    icon: "download",
    target: "_blank",
  },
  { label: "LLM Context (llms.txt)", href: "/llms.txt", icon: "sparkles", target: "_blank" },
];
</script>

<template>
  <NavMegaMenu
    menu-id="docs"
    label="Docs"
    :active-prefixes="['/guide/', '/ansatz/', '/cli/', '/reference/', '/languages/']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: 'Documentation Home →', href: '/guide/introduction' }"
    :screen-menu="props.screenMenu"
  />
</template>
