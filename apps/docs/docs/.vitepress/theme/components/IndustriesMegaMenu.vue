<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { INDUSTRIES, INDUSTRY_GROUPS } from "../data/industries";
import { LANGUAGE_COUNT } from "../data/languages";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const columns = computed<MegaMenuColumn[]>(() =>
  INDUSTRY_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    items: INDUSTRIES.filter((i) => i.group === g.id).map((item) => ({
      name: item.name,
      tagline: item.tagline,
      href: `/industries/${item.slug}`,
      icon: item.icon,
      accent: item.accent,
    })),
  })),
);

const feature: MegaMenuFeature = {
  eyebrow: "Featured workflow",
  title: "IEEE 2800 ride-through, automated",
  body: "Verify LVRT/HVRT compliance for inverter-based resources directly from PSCAD projects, with no desktop license required.",
  code: "msx pscad verify-ieee2800 Plant.pscx",
  ctaLabel: "Explore Power Systems",
  ctaHref: "/industries/power-systems",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: "All industries", href: "/industries/", icon: "globe" },
  { label: `Browse all ${LANGUAGE_COUNT} languages & formats`, href: "/languages/overview", icon: "layers" },
  { label: "Try it in the Playground", href: "/playground", icon: "terminal", target: "_self" },
];
</script>

<template>
  <NavMegaMenu
    menu-id="industries"
    label="Industries"
    :active-prefixes="['/industries']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: 'All industries →', href: '/industries/' }"
    :screen-menu="props.screenMenu"
  />
</template>
