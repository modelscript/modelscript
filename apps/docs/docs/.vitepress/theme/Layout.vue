<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inBrowser, useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed, defineAsyncComponent } from "vue";
import DocBreadcrumbs from "./components/DocBreadcrumbs.vue";
import LanguageHeader from "./components/LanguageHeader.vue";

const TurbineHero = defineAsyncComponent(() => import("./components/TurbineHero.vue"));
const NotFound = defineAsyncComponent(() => import("./components/NotFound.vue"));
const LanguageExample = defineAsyncComponent(() => import("./components/LanguageExample.vue"));

const { Layout } = DefaultTheme;
const route = useRoute();
const isLanguageDetailPage = computed(
  () => route.path.startsWith("/languages/") && !route.path.startsWith("/languages/overview"),
);
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <ClientOnly>
        <TurbineHero />
      </ClientOnly>
      <div v-if="!inBrowser" class="turbine-ssr-fallback">
        <img class="fallback-img" src="/ms-logo.png" alt="ModelScript Turbine Engine" />
      </div>
    </template>
    <template #doc-before>
      <DocBreadcrumbs />
      <LanguageHeader v-if="isLanguageDetailPage" />
      <LanguageExample v-if="isLanguageDetailPage" />
    </template>
    <template #not-found>
      <NotFound />
    </template>
  </Layout>
</template>

