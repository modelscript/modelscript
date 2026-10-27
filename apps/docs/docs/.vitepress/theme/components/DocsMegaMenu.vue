<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const columns: MegaMenuColumn[] = [
  {
    id: "getting-started",
    label: "Getting Started",
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
        name: "CLI Overview",
        tagline: "Architecture and global workflows of the msx toolchain",
        href: "/cli/overview",
        icon: "terminal",
        accent: "#818cf8",
      },
    ],
  },
  {
    id: "guides-operations",
    label: "Guides & Operations",
    items: [
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
        name: "Embedding Artifacts",
        tagline: "Embed interactive 3D CAD, schematics & plots in web apps",
        href: "/guide/embedding",
        icon: "code",
        accent: "#2dd4bf",
      },
      {
        name: "Enterprise Administration",
        tagline: "Self-hosted deployment, RBAC, SSO, billing & audit logs",
        href: "/guide/administration",
        icon: "shield",
        accent: "#818cf8",
      },
    ],
  },
  {
    id: "toolchain-reference",
    label: "Toolchain Reference",
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
        tagline: "Searchable catalog of 790 static diagnostics across 43 formats",
        href: "/reference/linter-rules",
        icon: "check",
        accent: "#22d3ee",
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
        tagline: "All 31 MCP tool schemas, LSP capabilities & DAP debugger",
        href: "/reference/mcp-and-ide",
        icon: "layers",
        accent: "#a78bfa",
      },
    ],
  },
];

const feature: MegaMenuFeature = {
  eyebrow: "Quickstart in 30 seconds",
  title: "Simulate & verify from the CLI",
  body: "Flatten hierarchical models, run stiff DAE solvers, and emit SARIF verification proofs from your terminal.",
  code: "msx simulate BouncingBall model.mo --stop-time 5",
  ctaLabel: "Read Getting Started",
  ctaHref: "/guide/getting-started",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: "Documentation Home", href: "/guide/introduction", icon: "globe" },
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
    :active-prefixes="['/guide/', '/cli/', '/reference/']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: 'Documentation Home →', href: '/guide/introduction' }"
    :screen-menu="props.screenMenu"
  />
</template>
