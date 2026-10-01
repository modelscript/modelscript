<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
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
    </template>
  </Layout>
</template>
