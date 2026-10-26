<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inBrowser } from "vitepress";
import DefaultTheme from "vitepress/theme";
import TurbineHero from "./components/TurbineHero.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <ClientOnly>
        <TurbineHero />
      </ClientOnly>
      <div v-if="!inBrowser" class="turbine-ssr-fallback">
        <div class="fallback-aura"></div>
        <img class="fallback-img" src="/ms-logo.png" alt="ModelScript Turbine Engine" />
      </div>
    </template>
  </Layout>
</template>
