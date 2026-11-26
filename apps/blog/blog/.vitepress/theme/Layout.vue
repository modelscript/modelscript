<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inBrowser, useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { nextTick, onMounted, watch } from "vue";
import PostFooter from "./components/PostFooter.vue";
import PostHeader from "./components/PostHeader.vue";
import { useAnsatzOrigin } from "./util/ansatz";

const { Layout } = DefaultTheme;
const route = useRoute();
const { ansatzOrigin } = useAnsatzOrigin();

function syncLocalNavLinks(): void {
  if (!inBrowser) return;
  const { hostname, port, protocol } = window.location;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
  if (!isLocal) return;

  const docsOrigin =
    hostname === "blog.localhost" && !port ? `${protocol}//docs.localhost` : `${protocol}//${hostname}:5173`;
  const ansatzTarget = ansatzOrigin.value.replace(/\/$/, "");

  document.querySelectorAll<HTMLAnchorElement>('a[href^="https://modelscript.org"]').forEach((a) => {
    a.href = a.href.replace(/^https:\/\/modelscript\.org/, docsOrigin);
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href^="https://ansatz.social"]').forEach((a) => {
    a.href = a.href.replace(/^https:\/\/ansatz\.social/, ansatzTarget);
  });
}

onMounted(() => {
  syncLocalNavLinks();
});

watch(
  [() => route.path, ansatzOrigin],
  () => {
    nextTick(() => syncLocalNavLinks());
  },
  { flush: "post" },
);
</script>

<template>
  <Layout>
    <template #nav-bar-title-after>
      <span class="ms-nav-blog-badge">Blog</span>
    </template>
    <template #doc-before>
      <PostHeader />
    </template>
    <template #doc-after>
      <PostFooter />
    </template>
  </Layout>
</template>
