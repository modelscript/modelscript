<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { LANGUAGE_COUNT } from "../data/languages";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const columns: MegaMenuColumn[] = [
  {
    id: "systems-physics",
    label: "Systems, Physics & MBSE",
    items: [
      {
        name: "ModelScript (.msx)",
        tagline: "Native systems modeling, cross-domain bindings & queries",
        href: "/languages/modelscript",
        icon: "sparkles",
        accent: "#22d3ee",
      },
      {
        name: "Modelica (.mo)",
        tagline: "Acausal multi-domain physical systems & MSL 4.x",
        href: "/languages/modelica",
        icon: "activity",
        accent: "#818cf8",
      },
      {
        name: "SysML v2 & ReqIF",
        tagline: "Systems architecture, KerML semantics & requirements",
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
    ],
  },
  {
    id: "geometry-cae",
    label: "Geometry, Multibody & CAE",
    items: [
      {
        name: "STEP CAD & OpenSCAD",
        tagline: "ISO 10303 AP242 B-Rep assemblies, PMI & parametric CSG",
        href: "/languages/step",
        icon: "cube",
        accent: "#2dd4bf",
      },
      {
        name: "CFD & FEA Continuum",
        tagline: "SU2 / OpenFOAM fluid meshes & CalculiX / Abaqus structural",
        href: "/languages/cfd",
        icon: "layers",
        accent: "#fbbf24",
      },
      {
        name: "Robotics & Multibody",
        tagline: "ROS URDF, SIMPACK, MSC Adams & GENSYS rail dynamics",
        href: "/languages/urdf",
        icon: "bot",
        accent: "#a78bfa",
      },
      {
        name: "Process, Thermal & Flow",
        tagline: "OLGA multiphase, Aspen Plus, RELAP5 & EnergyPlus",
        href: "/languages/olga",
        icon: "flame",
        accent: "#fb7185",
      },
    ],
  },
  {
    id: "grid-electronics",
    label: "Grid, Electronics & Code",
    items: [
      {
        name: "Power Systems & EMT",
        tagline: "PSCAD EMT, Siemens PSS/E & OpenDSS distribution grids",
        href: "/languages/pscad",
        icon: "zap",
        accent: "#facc15",
      },
      {
        name: "Electronics & RF",
        tagline: "SPICE netlists, Verilog-A compact models, IBIS & Touchstone",
        href: "/languages/spice",
        icon: "cpu",
        accent: "#818cf8",
      },
      {
        name: "Embedded & Controls",
        tagline: "AUTOSAR ARXML, PLCopen IEC 61131-3, ANSI C & Fortran",
        href: "/languages/autosar",
        icon: "code",
        accent: "#22d3ee",
      },
      {
        name: "Ontologies & Data",
        tagline: "OWL2 description logic, LPS, CSV trajectories & OpenDRIVE",
        href: "/languages/owl2",
        icon: "database",
        accent: "#34d399",
      },
    ],
  },
];

const feature: MegaMenuFeature = {
  eyebrow: "Polyglot Compiler Matrix",
  title: `${LANGUAGE_COUNT} formats, one shared DAE & SMT core`,
  body: "Every format compiles into the same zero-allocation WebAssembly CST and DAE arena with 790 static lint rules.",
  code: "msx verify BrakingController brake.mo --format sarif",
  ctaLabel: `Browse all ${LANGUAGE_COUNT} languages`,
  ctaHref: "/languages/overview",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: `All ${LANGUAGE_COUNT} languages & capability matrix`, href: "/languages/overview", icon: "grid" },
  { label: "Standards & Export Formats (FMI 3.0, STEP, SARIF)", href: "/reference/export-formats", icon: "upload" },
  { label: "790 Compiler Linter Rules", href: "/reference/linter-rules", icon: "check" },
];
</script>

<template>
  <NavMegaMenu
    menu-id="languages"
    label="Languages"
    :active-prefixes="['/languages/']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: `All ${LANGUAGE_COUNT} languages & formats →`, href: '/languages/overview' }"
    :screen-menu="props.screenMenu"
  />
</template>
