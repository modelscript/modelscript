<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, computed } from "vue";

interface LanguageItem {
  name: string;
  category: "systems" | "kinematics" | "fluids" | "power" | "cad";
  badge: string;
  role: string;
  link: string;
}

const activeCategory = ref<string>("all");

const languages: LanguageItem[] = [
  // Systems & Architecture
  {
    name: "Modelica",
    category: "systems",
    badge: ".mo",
    role: "Acausal Multi-Domain Physics",
    link: "/languages/modelica",
  },
  {
    name: "SysML v2 / KerML",
    category: "systems",
    badge: ".sysml",
    role: "Systems Architecture & Requirements",
    link: "/languages/sysml2",
  },
  {
    name: "MATLAB Simulink",
    category: "systems",
    badge: ".slx / .mdl",
    role: "Block Diagrams & Control Systems",
    link: "/languages/simulink",
  },
  {
    name: "AUTOSAR",
    category: "systems",
    badge: ".arxml",
    role: "Automotive Software Components",
    link: "/languages/autosar",
  },
  {
    name: "ReqIF",
    category: "systems",
    badge: ".reqif",
    role: "Requirements Interchange Format",
    link: "/languages/reqif",
  },
  {
    name: "ModelScript",
    category: "systems",
    badge: ".msx",
    role: "Native Multi-Paradigm Thread",
    link: "/languages/modelscript",
  },

  // Multi-Body & Kinematics
  {
    name: "SIMPACK",
    category: "kinematics",
    badge: ".spck",
    role: "Nonlinear Multibody Dynamics",
    link: "/languages/simpack",
  },
  {
    name: "GENSYS",
    category: "kinematics",
    badge: ".gen",
    role: "Railway Vehicle Dynamics & Track",
    link: "/languages/gensys",
  },
  {
    name: "MSC Adams",
    category: "kinematics",
    badge: ".adm",
    role: "Mechanical System Kinematics",
    link: "/languages/adams",
  },
  {
    name: "URDF / Xacro",
    category: "kinematics",
    badge: ".urdf",
    role: "Robotics Kinematic Chains",
    link: "/languages/urdf",
  },

  // Fluids, Thermal & Propulsion
  {
    name: "OLGA",
    category: "fluids",
    badge: ".genkey",
    role: "Transient Multiphase Pipeline Flow",
    link: "/languages/olga",
  },
  {
    name: "PipelineStudio",
    category: "fluids",
    badge: ".lps",
    role: "Gas & Liquid Pipeline Hydraulics",
    link: "/languages/lps",
  },
  {
    name: "GT-SUITE",
    category: "fluids",
    badge: ".gtm",
    role: "Engine, Powertrain & Thermal Flow",
    link: "/languages/gtsuite",
  },
  {
    name: "EASY5",
    category: "fluids",
    badge: ".ez5",
    role: "Aerospace Control & Fluid Systems",
    link: "/languages/easy5",
  },
  {
    name: "SIMA / RIFLEX",
    category: "fluids",
    badge: ".sima",
    role: "Offshore Marine Hydrodynamics",
    link: "/languages/sima",
  },
  {
    name: "NASA ROCETS",
    category: "fluids",
    badge: ".roc",
    role: "Rocket Engine & Propulsion Cycles",
    link: "/languages/rocets",
  },
  {
    name: "EnergyPlus",
    category: "fluids",
    badge: ".idf",
    role: "Building Energy & HVAC Physics",
    link: "/languages/energyplus",
  },
  {
    name: "EPANET",
    category: "fluids",
    badge: ".inp",
    role: "Pressurized Water Distribution",
    link: "/languages/epanet",
  },

  // Power Systems & Electronics
  {
    name: "PSCAD",
    category: "power",
    badge: ".pscx",
    role: "Electromagnetic Transient (EMT) Grid",
    link: "/languages/pscad",
  },
  {
    name: "PSS/E",
    category: "power",
    badge: ".raw",
    role: "Transmission Power Flow & Dynamics",
    link: "/languages/psse",
  },
  { name: "SPICE", category: "power", badge: ".cir", role: "Analog Electronic Circuits", link: "/languages/spice" },
  {
    name: "PLCopen",
    category: "power",
    badge: ".xml",
    role: "Industrial Automation & IEC 61131-3",
    link: "/languages/plcopen",
  },
  {
    name: "Verilog-A",
    category: "power",
    badge: ".va",
    role: "Semiconductor Behavioral Models",
    link: "/languages/verilog-a",
  },

  // CAD, Geometry & Infrastructure
  {
    name: "STEP (ISO 10303)",
    category: "cad",
    badge: ".step",
    role: "3D Boundary Representation & CSG",
    link: "/languages/step",
  },
  { name: "OpenSCAD", category: "cad", badge: ".scad", role: "Programmatic Parametric CAD", link: "/languages/scad" },
  {
    name: "OpenDRIVE",
    category: "cad",
    badge: ".xodr",
    role: "Road Network Geometry & Logic",
    link: "/languages/opendrive",
  },
  {
    name: "SU2 / CFD",
    category: "cad",
    badge: ".su2",
    role: "Computational Fluid Dynamics Mesh",
    link: "/languages/cfd",
  },
  {
    name: "FEA Structural",
    category: "cad",
    badge: ".inp",
    role: "Finite Element Elasticity & Stress",
    link: "/languages/fea",
  },
  {
    name: "OWL2 Ontology",
    category: "cad",
    badge: ".owl",
    role: "Semantic Knowledge & Ontologies",
    link: "/languages/owl2",
  },
  {
    name: "SSP Standard",
    category: "cad",
    badge: ".ssp",
    role: "System Structure & Parameterization",
    link: "/languages/ssp",
  },
  {
    name: "CSV / Telemetry",
    category: "cad",
    badge: ".csv",
    role: "Time-Series & Sensor Logs",
    link: "/languages/csv",
  },
  {
    name: "CCSDS Space",
    category: "cad",
    badge: ".xtce",
    role: "Spacecraft Telemetry & Commands",
    link: "/languages/ccsds",
  },
  {
    name: "Fortran",
    category: "cad",
    badge: ".f90",
    role: "Legacy Scientific Subroutines",
    link: "/languages/fortran",
  },
];

const categories = [
  { id: "all", label: "All Dialects (33)" },
  { id: "systems", label: "Systems & Architecture" },
  { id: "kinematics", label: "Multi-Body & Kinematics" },
  { id: "fluids", label: "Fluids & Propulsion" },
  { id: "power", label: "Power & Electronics" },
  { id: "cad", label: "CAD & Continuum" },
];

const filteredLanguages = computed(() => {
  if (activeCategory.value === "all") return languages;
  return languages.filter((l) => l.category === activeCategory.value);
});
</script>

<template>
  <section class="home-section languages-section">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">Polyglot Computable Digital Thread</span>
        <h2 class="section-title">One Compiler. 33+ Modeling Languages.</h2>
        <p class="section-subtitle">
          Unify requirements, physical simulation, multi-body kinematics, fluid dynamics, power systems, and 3D CAD
          without brittle export bridges.
        </p>
      </div>

      <!-- Category Filter Pills -->
      <div class="category-tabs">
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          class="tab-btn"
          :class="{ active: activeCategory === cat.id }"
          @click="activeCategory = cat.id"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Language Cards Grid -->
      <div class="languages-grid">
        <a v-for="lang in filteredLanguages" :key="lang.name" :href="lang.link" class="lang-card">
          <div class="lang-top">
            <span class="lang-name">{{ lang.name }}</span>
            <span class="lang-badge">{{ lang.badge }}</span>
          </div>
          <p class="lang-role">{{ lang.role }}</p>
        </a>
      </div>

      <div class="languages-cta">
        <a href="/languages/overview" class="btn-matrix"> View Full Polyglot Compatibility Matrix &rarr; </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  padding: 64px 24px;
}

.languages-section {
  background: var(--vp-c-bg);
  position: relative;
}

.section-container {
  max-width: 1152px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 36px;
}

.section-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(1.8rem, 3.5vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.section-subtitle {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  margin-top: 8px;
  line-height: 1.6;
  max-width: 780px;
  margin-left: auto;
  margin-right: auto;
}

.category-tabs {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 32px;
}

.tab-btn {
  padding: 6px 14px;
  font-size: 0.86rem;
  font-weight: 500;
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.tab-btn.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  font-weight: 600;
}

.languages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  margin-bottom: 36px;
}

.lang-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 16px;
  text-decoration: none;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.lang-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.lang-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.lang-name {
  font-size: 0.96rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.lang-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 2px 7px;
  border-radius: 6px;
}

.lang-role {
  font-size: 0.83rem;
  color: var(--vp-c-text-2);
  line-height: 1.4;
  margin: 0;
}

.languages-cta {
  text-align: center;
}

.btn-matrix {
  display: inline-flex;
  align-items: center;
  padding: 10px 22px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  transition: all 0.2s ease;
}

.btn-matrix:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  transform: translateY(-1px);
}
</style>
