<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import mcpData from "../data/mcp-tools.generated.json";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const ansatzHref = ref("https://ansatz.social/explore");
const ansatzLabel = ref("Ansatz Network (ansatz.social)");

onMounted(() => {
  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost");
    if (isLocal) {
      const targetPort = port && port !== "5173" && port !== "4173" ? port : "3001";
      ansatzHref.value = `${protocol}//${hostname}:${targetPort}/explore`;
      ansatzLabel.value = `Ansatz Network (${hostname}:${targetPort})`;
    }
  }
});

const columns: MegaMenuColumn[] = [
  {
    id: "surfaces",
    label: "Workbenches & Surfaces",
    items: [
      {
        name: "Sketch",
        tagline: "Zero-install drafting, schematics & live simulator",
        href: "/sketch",
        icon: "play",
        accent: "#22d3ee",
        target: "_self",
      },
      {
        name: "Studio",
        tagline: "VS Code workbench with schematics, 3D CAD & plots",
        href: "/studio",
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
    id: "cloud-hil",
    label: "HIL, Cloud & Network",
    items: [
      {
        name: `MCP Tool Server (${mcpData.toolCount} Tools)`,
        tagline: "Closed-loop tool calling for Claude, Cursor & agents",
        href: "/reference/mcp-and-ide",
        icon: "sparkles",
        accent: "#a78bfa",
      },
      {
        name: "SIL & Real-Time HIL",
        tagline: "Deterministic fixed-step WebAssembly execution",
        href: "/architecture/hil-wasm-runtime",
        icon: "gauge",
        accent: "#fb7185",
      },
      {
        name: "Ansatz Network & Hub",
        tagline: "Federated engineering network, registry & CAS",
        href: "/ansatz/overview",
        icon: "globe",
        accent: "#38bdf8",
      },
      {
        name: "Cloud HPC Simulation",
        tagline: "Slurm cluster offload & batched parameter sweeps",
        href: "/ansatz/cloud-hpc",
        icon: "zap",
        accent: "#fbbf24",
      },
      {
        name: "ActivityPub Federation",
        tagline: "Decentralized model graphs, peer remotes & follow",
        href: "/ansatz/federation",
        icon: "link",
        accent: "#34d399",
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

const footerLinks = computed<MegaMenuFooterLink[]>(() => [
  { label: ansatzLabel.value, href: ansatzHref.value, icon: "globe", target: "_blank" },
  { label: "Self-Hosting Guide", href: "/ansatz/self-hosting", icon: "database" },
  { label: "Package Registry", href: "/ansatz/package-registry", icon: "box" },
  { label: "Compiler Architecture", href: "/architecture/overview", icon: "cpu" },
  { label: "Algorithms Catalog (16 engines)", href: "/algorithms/overview", icon: "activity" },
  { label: "Documentation Home", href: "/guide/introduction", icon: "globe" },
]);
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

