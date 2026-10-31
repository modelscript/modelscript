<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import mcpData from "../data/mcp-tools.generated.json";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const columns: MegaMenuColumn[] = [
  {
    id: "surfaces",
    label: "Workbenches & Surfaces",
    items: [
      {
        name: "Browser Playground",
        tagline: "Zero-install editor, linter & live simulator",
        href: "/playground",
        icon: "play",
        accent: "#22d3ee",
        target: "_self",
      },
      {
        name: "Web IDE",
        tagline: "VS Code workbench with schematics, 3D CAD & plots",
        href: "/ide",
        icon: "layers",
        accent: "#818cf8",
        target: "_self",
      },
      {
        name: "VS Code Extension",
        tagline: "Polyglot LSP, diagnostics & simulation debugger",
        href: "https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript",
        icon: "code",
        accent: "#38bdf8",
        target: "_blank",
      },
      {
        name: "Native Desktop App",
        tagline: "Offline builds for air-gapped environments",
        href: "https://github.com/modelscript/modelscript/releases",
        icon: "download",
        accent: "#34d399",
        target: "_blank",
      },
    ],
  },
  {
    id: "engine",
    label: "Engine & Math Core",
    items: [
      {
        name: "Compiler Architecture",
        tagline: "WASM GLR parser, Salsa query DAG & linear DAE arena",
        href: "/architecture/overview",
        icon: "cpu",
        accent: "#818cf8",
      },
      {
        name: "Algorithms & Solvers",
        tagline: "Pantelides index reduction, BLT, tearing & IDA/CVODE",
        href: "/algorithms/overview",
        icon: "activity",
        accent: "#2dd4bf",
      },
      {
        name: "Triple Graph Grammars",
        tagline: "Bidirectional sync across SysML v2, Modelica & CAD",
        href: "/architecture/tgg",
        icon: "link",
        accent: "#38bdf8",
      },
      {
        name: "Formal Verification & SMT",
        tagline: "13 Nelson-Oppen theories, CHC/IC3 & abstract domains",
        href: "/architecture/theory-coordinator",
        icon: "shield",
        accent: "#34d399",
      },
    ],
  },
  {
    id: "ai-automation",
    label: "AI, Automation & HIL",
    items: [
      {
        name: `MCP Server (${mcpData.toolCount} Tools)`,
        tagline: "Closed-loop tool calling for Claude, Cursor & agents",
        href: "/reference/mcp-and-ide",
        icon: "sparkles",
        accent: "#a78bfa",
      },
      {
        name: "AI Agents & Synthesis",
        tagline: "Counterexample-guided tuning & autonomous PR bots",
        href: "/guide/ai-agents",
        icon: "bot",
        accent: "#22d3ee",
      },
      {
        name: "CI/CD & GitHub Actions",
        tagline: "Headless SARIF gates, FMU export & schematic PR diffs",
        href: "/guide/ci-cd",
        icon: "git",
        accent: "#fbbf24",
      },
      {
        name: "SIL & Real-Time HIL",
        tagline: "Deterministic fixed-step WebAssembly execution",
        href: "/architecture/hil-wasm-runtime",
        icon: "gauge",
        accent: "#fb7185",
      },
      {
        name: "Ansatz Platform & Hub",
        tagline: "Federated engineering network, registry & cloud HPC",
        href: "/ansatz/overview",
        icon: "globe",
        accent: "#38bdf8",
      },
    ],
  },
];

const feature: MegaMenuFeature = {
  eyebrow: "Agentic Engineering",
  title: "Ground AI agents in physics & proofs",
  body: `Expose ${mcpData.toolCount} compiler, solver, and SMT verification tools to AI assistants over the Model Context Protocol.`,
  code: "npx -y @modelscript/mcp",
  ctaLabel: "Explore MCP & IDE Workbench",
  ctaHref: "/reference/mcp-and-ide",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: "Ansatz Network (ansatz.social)", href: "https://ansatz.social", icon: "globe", target: "_blank" },
  { label: "Self-Hosting Guide", href: "/ansatz/self-hosting", icon: "database" },
  { label: "ActivityPub Federation", href: "/ansatz/federation", icon: "link" },
  { label: "Package Registry", href: "/ansatz/package-registry", icon: "box" },
  { label: "Cloud HPC Simulation", href: "/ansatz/cloud-hpc", icon: "zap" },
  { label: "Compiler Architecture", href: "/architecture/overview", icon: "cpu" },
  { label: "Algorithms Catalog (16 engines)", href: "/algorithms/overview", icon: "activity" },
  { label: "LLM Context (llms.txt)", href: "/llms.txt", icon: "sparkles", target: "_blank" },
];
</script>

<template>
  <NavMegaMenu
    menu-id="platform"
    label="Platform"
    :active-prefixes="['/architecture/', '/algorithms/']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: 'Compiler Architecture →', href: '/architecture/overview' }"
    :screen-menu="props.screenMenu"
  />
</template>

