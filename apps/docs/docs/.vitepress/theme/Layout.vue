<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inBrowser, useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed, defineAsyncComponent, nextTick, onMounted, watch } from "vue";
import DocBreadcrumbs from "./components/DocBreadcrumbs.vue";
import LanguageHeader from "./components/LanguageHeader.vue";
import { useAnsatzOrigin, useBlogOrigin } from "./util/ansatz";

const NotFound = defineAsyncComponent(() => import("./components/NotFound.vue"));
const LanguageExample = defineAsyncComponent(() => import("./components/LanguageExample.vue"));

const { Layout } = DefaultTheme;
const route = useRoute();
const { ansatzOrigin } = useAnsatzOrigin();
const { blogOrigin } = useBlogOrigin();
const isLanguageDetailPage = computed(
  () => route.path.startsWith("/languages/") && !route.path.startsWith("/languages/overview"),
);

function syncLocalOriginLinks(): void {
  if (!inBrowser) return;
  const origin = ansatzOrigin.value.replace(/\/$/, "");
  const links = document.querySelectorAll<HTMLAnchorElement>(".VPHero .actions a");
  links.forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (href.endsWith("/editor") || href.endsWith("/ansatz")) {
      a.href = `${origin}${href.endsWith("/editor") ? "/editor" : "/ansatz"}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else if (href.endsWith("/studio")) {
      a.href = `${origin}/studio`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });

  const blogTarget = blogOrigin.value.replace(/\/$/, "");
  if (blogTarget !== "https://blog.modelscript.org") {
    document
      .querySelectorAll<HTMLAnchorElement>('a[href^="https://blog.modelscript.org"]')
      .forEach((a) => {
        a.href = a.href.replace(/^https:\/\/blog\.modelscript\.org/, blogTarget);
      });
  }
}

onMounted(() => {
  syncLocalOriginLinks();
});

watch(
  [() => route.path, ansatzOrigin, blogOrigin],
  () => {
    nextTick(() => syncLocalOriginLinks());
  },
  { flush: "post" },
);
</script>

<template>
  <Layout>
    <template #nav-bar-title-after>
      <span class="ms-nav-beta-badge">Beta</span>
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


