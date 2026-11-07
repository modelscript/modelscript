<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inBrowser, useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed, defineAsyncComponent, nextTick, onMounted, watch } from "vue";
import DocBreadcrumbs from "./components/DocBreadcrumbs.vue";
import LanguageHeader from "./components/LanguageHeader.vue";
import { useAnsatzOrigin } from "./util/ansatz";

const TurbineHero = defineAsyncComponent(() => import("./components/TurbineHero.vue"));
const NotFound = defineAsyncComponent(() => import("./components/NotFound.vue"));
const LanguageExample = defineAsyncComponent(() => import("./components/LanguageExample.vue"));

const { Layout } = DefaultTheme;
const route = useRoute();
const ansatzOrigin = useAnsatzOrigin();
const isLanguageDetailPage = computed(
  () => route.path.startsWith("/languages/") && !route.path.startsWith("/languages/overview"),
);

function syncHeroAnsatzLinks(): void {
  if (!inBrowser) return;
  const origin = ansatzOrigin.value.replace(/\/$/, "");
  const links = document.querySelectorAll<HTMLAnchorElement>(".VPHero .actions a");
  links.forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (href.endsWith("/morsel")) {
      a.href = `${origin}/morsel`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else if (href.endsWith("/studio")) {
      a.href = `${origin}/studio`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
}

onMounted(() => {
  syncHeroAnsatzLinks();
});

watch(
  [() => route.path, ansatzOrigin],
  () => {
    nextTick(() => syncHeroAnsatzLinks());
  },
  { flush: "post" },
);
</script>

<template>
  <Layout>
    <template #nav-bar-title-after>
      <span class="ms-nav-beta-badge">Beta</span>
    </template>
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


