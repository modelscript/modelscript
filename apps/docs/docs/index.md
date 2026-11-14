---
layout: home
markdownStyles: false
title: ModelScript — The Open Computable Digital Thread for Engineering
titleTemplate: false

hero:
  name: "ModelScript"
  text: "One web-native compiler for every engineering model"
  tagline: "Build a computable digital thread across 92 engineering formats. Link requirements, architecture, multi-physics models and 3D CAD — with simulation, formal verification, optimization and AI-agent tooling (MCP) built in."
  image:
    src: /ms-logo.png
    alt: ModelScript 3D turbine engine
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Try Morsel
      link: https://ansatz.social/morsel
      target: _blank
      rel: noopener noreferrer
    - theme: alt
      text: Launch Studio
      link: https://ansatz.social/studio
      target: _blank
      rel: noopener noreferrer
---

<script setup lang="ts">
import {
  isHomeAiAgentEnabled,
  isHomeSemanticCoordinatorEnabled,
  isHomeWorkflowPairsEnabled,
} from "./.vitepress/theme/data/feature-flags";
</script>

<HomeStats />

<HomeFormatStrip />

<HomeIndustries />

<HomeWorkflowPairs v-if="isHomeWorkflowPairsEnabled" />

<HomeSemanticCoordinator v-if="isHomeSemanticCoordinatorEnabled" />

<HomeThread />

<HomeAiAgent v-if="isHomeAiAgentEnabled" />

<HomeCapabilities />

<HomeSurfaces />

<HomeVsCode />

<HomeCta />
