<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";

type Interval = "monthly" | "annual";

interface Plan {
  id: string;
  name: string;
  audience: string;
  /** Monthly / annual-billed per-month price for self-serve plans. */
  monthly?: number;
  annual?: number;
  /** Yearly price for contract plans. */
  yearly?: number;
  customLabel?: string;
  priceNote: string;
  summary: string;
  features: string[];
  cta: { label: string; href: string };
  comingSoon?: boolean;
}

const MAIL = "enterprise@modelscript.org";
const mail = (subject: string) => `mailto:${MAIL}?subject=${encodeURIComponent(subject)}`;

const interval = ref<Interval>("annual");

/* Group 1: self-serve plans (match the in-app billing tiers). */
const selfServe: Plan[] = [
  {
    id: "free",
    name: "Community",
    audience: "Individuals, researchers, open source",
    monthly: 0,
    annual: 0,
    priceNote: "free forever",
    summary: "Everything you need to model and simulate in your browser or terminal.",
    features: [
      "Unlimited in-browser simulation",
      "Local CLI (msx) and local MCP server",
      "Public repositories and package registry",
      "Community support on GitHub",
    ],
    cta: { label: "Get started free", href: "/guide/getting-started" },
  },
  {
    id: "pro",
    name: "Pro",
    audience: "Professional engineers",
    monthly: 29,
    annual: 24,
    priceNote: "per month",
    summary: "Cloud compute for models that outgrow your laptop.",
    features: [
      "Everything in Community",
      "200 cloud HPC credits per month",
      "Priority simulation queue",
      "GPU surrogate-model training",
    ],
    cta: { label: "Upgrade to Pro", href: "https://ansatz.social/settings/billing#subscription-tiers" },
    comingSoon: true,
  },
  {
    id: "team",
    name: "Team",
    audience: "Engineering teams",
    monthly: 99,
    annual: 79,
    priceNote: "per month, per organization",
    summary: "Shared compute, private packages and access control for a team.",
    features: [
      "Everything in Pro",
      "600 shared organization HPC credits",
      "Private package registries",
      "Role-based access control",
      "MPI cluster access",
    ],
    cta: { label: "Upgrade to Team", href: "https://ansatz.social/settings/billing#subscription-tiers" },
    comingSoon: true,
  },
];

/* Group 2: contract plans (commercial licensing and on-premise). */
const contract: Plan[] = [
  {
    id: "sdk",
    name: "Commercial SDK",
    audience: "Software vendors shipping ModelScript inside a closed-source product",
    yearly: 12000,
    priceNote: "per year, per product",
    summary: "A license to redistribute ModelScript in your product without the AGPL source-sharing obligations. For vendors, not for internal use.",
    features: [
      "AGPL-3.0 copyleft exemption",
      "Embed in proprietary SaaS and desktop apps",
      "Royalty-free redistribution",
      "Hosted MCP and SysML v2 REST APIs",
      "Open-core features only (no Enterprise Edition code)",
      "48-hour response on blocking issues",
      "Private channel with the compiler team",
    ],
    cta: { label: "Request a pilot", href: mail("[Commercial SDK Inquiry] ModelScript Evaluation") },
    comingSoon: true,
  },
  {
    id: "enterprise",
    name: "Enterprise Appliance",
    audience: "Organizations running ModelScript internally: utilities, aerospace, automotive, regulated industries",
    yearly: 48000,
    priceNote: "per year, starting price. Final price depends on sites and seats.",
    summary: "A self-contained deployment of ModelScript with the Enterprise Edition features, for internal use on networks with no internet access.",
    features: [
      "Full Enterprise Edition feature set (ee/)",
      "Air-gapped container image (Docker / Kubernetes)",
      "SAML 2.0 / OIDC single sign-on and multi-org RBAC",
      "Documentation to support NERC CIP, FERC CEII, ITAR/EAR and FDA 21 CFR Part 11 programs",
      "On-premise HPC (Slurm) and digital twins",
      "Hardware-in-the-loop, AUTOSAR and PLC code generation",
      "PLM and legacy CAE bridges",
      "24-hour mission-critical support",
      "Internal use only. Redistribution in a product needs the Commercial SDK.",
    ],
    cta: { label: "Talk to us", href: mail("[Enterprise Appliance Inquiry] Evaluation") },
    comingSoon: true,
  },
];

const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

function price(p: Plan): string {
  if (p.yearly !== undefined) return p.customLabel ?? fmt(p.yearly);
  const v = interval.value === "annual" ? p.annual : p.monthly;
  return fmt(v ?? 0);
}

const priceNotePrefix = (p: Plan) => (p.id === "enterprise" ? "From " : "");

const isExternal = (href: string) => /^https?:/.test(href);

/* Comparison table */
interface Row {
  feature: string;
  values: [string, string, string, string, string];
}
const columns = ["Community", "Pro", "Team", "Commercial SDK", "Enterprise"];

const sections: { title: string; rows: Row[] }[] = [
  {
    title: "Licensing",
    rows: [
      { feature: "License", values: ["AGPL-3.0", "AGPL-3.0", "AGPL-3.0", "Commercial OEM", "Enterprise License"] },
      { feature: "Embed in closed-source products", values: ["—", "—", "—", "Yes", "—"] },
      { feature: "Enterprise Edition (ee/) features", values: ["—", "—", "—", "—", "Yes"] },
    ],
  },
  {
    title: "Modeling and simulation",
    rows: [
      { feature: "Compilers, solvers and verification", values: ["Yes", "Yes", "Yes", "Yes", "Yes"] },
      { feature: "In-browser and CLI simulation", values: ["Yes", "Yes", "Yes", "Yes", "Yes"] },
      { feature: "Cloud HPC credits", values: ["—", "200 / mo", "600 / mo (shared)", "—", "On-premise cluster"] },
      { feature: "GPU surrogate training", values: ["—", "Yes", "Yes", "—", "Yes"] },
    ],
  },
  {
    title: "Collaboration and security",
    rows: [
      { feature: "Private package registry", values: ["—", "—", "Yes", "—", "Yes"] },
      { feature: "Access control", values: ["Basic", "Basic", "Roles (RBAC)", "Scoped API keys", "SAML / OIDC and multi-org RBAC"] },
      { feature: "Air-gapped deployment", values: ["—", "—", "—", "—", "Yes"] },
      { feature: "Audit log and approvals", values: ["—", "—", "—", "—", "Yes"] },
    ],
  },
  {
    title: "Integrations",
    rows: [
      { feature: "FMI export", values: ["Baseline", "Baseline", "Baseline", "Baseline", "Baseline"] },
      { feature: "Real-time hardware-in-the-loop, AUTOSAR, PLC code generation", values: ["—", "—", "—", "—", "Yes"] },
      { feature: "PLM and legacy CAE bridges", values: ["—", "—", "—", "—", "Yes"] },
      { feature: "Digital twins and historian", values: ["—", "—", "—", "—", "Yes"] },
    ],
  },
  {
    title: "Support",
    rows: [
      { feature: "Support", values: ["Community", "Community", "Email", "48-hour business SLA", "24-hour mission-critical SLA"] },
    ],
  },
];

const annualSavings = computed(() => (interval.value === "annual" ? "Billed annually, save about 17%" : "Billed monthly"));
</script>

<template>
  <div class="pricing">
    <div class="disclaimer" role="note">
      <strong>Paid plans are in development.</strong> Pro, Team, Commercial SDK and Enterprise Appliance are not yet
      available for purchase. The features and prices below are planned and may change before launch. Community is
      available today. To ask about early access, email
      <a href="mailto:founders@modelscript.org?subject=%5BEarly%20Access%5D%20ModelScript%20paid%20plans">founders@modelscript.org</a>.
    </div>

    <div class="pricing-toggle" role="group" aria-label="Billing interval">
      <button type="button" :aria-pressed="interval === 'monthly'" :class="{ active: interval === 'monthly' }" @click="interval = 'monthly'">
        Monthly
      </button>
      <button type="button" :aria-pressed="interval === 'annual'" :class="{ active: interval === 'annual' }" @click="interval = 'annual'">
        Annual <span class="save">save ~17%</span>
      </button>
    </div>
    <p class="pricing-sub" aria-live="polite">{{ annualSavings }} (applies to Pro and Team).</p>

    <h2 id="individuals-and-teams">Individuals and teams</h2>
    <p class="group-lead">Self-serve plans. Start free and upgrade when you need more compute or collaboration.</p>
    <div class="grid">
      <section v-for="p in selfServe" :key="p.id" class="card" :class="{ soon: p.comingSoon }" :aria-labelledby="`plan-${p.id}`">
        <span v-if="p.comingSoon" class="badge">Coming soon</span>
        <h3 :id="`plan-${p.id}`" class="name">{{ p.name }}</h3>
        <p class="audience">{{ p.audience }}</p>
        <p class="price">
          <span class="amount">{{ price(p) }}</span>
          <span class="unit">{{ p.priceNote }}</span>
        </p>
        <p class="summary">{{ p.summary }}</p>
        <ul>
          <li v-for="f in p.features" :key="f">{{ f }}</li>
        </ul>
        <a v-if="!p.comingSoon" class="cta" :href="p.cta.href" :target="isExternal(p.cta.href) ? '_blank' : undefined" :rel="isExternal(p.cta.href) ? 'noopener' : undefined">{{ p.cta.label }}</a>
        <span v-else class="cta disabled" role="link" aria-disabled="true">Coming soon</span>
      </section>
    </div>

    <h2 id="commercial-and-enterprise">Commercial and enterprise</h2>
    <p class="group-lead">Annual contracts for two different needs. The Commercial SDK is for vendors who <strong>ship</strong> ModelScript inside a product. The Enterprise Appliance is for organizations that <strong>run</strong> it internally. They are separate licenses. If you need both, contact us about a combined agreement.</p>
    <div class="grid two">
      <section v-for="p in contract" :key="p.id" class="card" :class="{ soon: p.comingSoon }" :aria-labelledby="`plan-${p.id}`">
        <span v-if="p.comingSoon" class="badge">Coming soon</span>
        <h3 :id="`plan-${p.id}`" class="name">{{ p.name }}</h3>
        <p class="audience">{{ p.audience }}</p>
        <p class="price">
          <span class="from">{{ priceNotePrefix(p) }}</span><span class="amount">{{ price(p) }}</span>
          <span class="unit">{{ p.priceNote }}</span>
        </p>
        <p class="summary">{{ p.summary }}</p>
        <ul>
          <li v-for="f in p.features" :key="f">{{ f }}</li>
        </ul>
        <a v-if="!p.comingSoon" class="cta" :href="p.cta.href">{{ p.cta.label }}</a>
        <span v-else class="cta disabled" role="link" aria-disabled="true">Coming soon</span>
      </section>
    </div>

    <h2 id="compare-plans">Compare plans</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Plan comparison table, scrollable">
      <table>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th v-for="c in columns" :key="c" scope="col">{{ c }}</th>
          </tr>
        </thead>
        <template v-for="s in sections" :key="s.title">
          <tbody>
            <tr class="section">
              <th :colspan="columns.length + 1" scope="colgroup">{{ s.title }}</th>
            </tr>
            <tr v-for="r in s.rows" :key="r.feature">
              <th scope="row">{{ r.feature }}</th>
              <td v-for="(v, i) in r.values" :key="i" :class="{ none: v === '—' }">
                <span v-if="v === '—'" aria-label="Not included">—</span>
                <template v-else>{{ v }}</template>
              </td>
            </tr>
          </tbody>
        </template>
      </table>
    </div>
  </div>
</template>

<style scoped>
.pricing-toggle {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 3px;
  margin: 8px 0 0;
  background: var(--vp-c-bg-soft);
}
.pricing-toggle button {
  border: 0;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 6px 16px;
  border-radius: 999px;
  cursor: pointer;
}
.pricing-toggle button.active {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
}
.pricing-toggle button:focus-visible,
.cta:focus-visible,
.table-wrap:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.save {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.85;
}
.pricing-sub {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 8px 0 0;
}
.group-lead {
  color: var(--vp-c-text-2);
  margin: 0 0 8px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  margin: 20px 0 8px;
}
.grid.two {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  background: var(--vp-c-bg-soft);
}
.card.soon {
  opacity: 0.6;
  filter: grayscale(1);
  background: var(--vp-c-bg-alt);
}
.disclaimer {
  border: 1px solid var(--vp-c-warning-1, #b58900);
  background: var(--vp-c-warning-soft, rgba(181, 137, 0, 0.1));
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.5;
  margin: 8px 0 16px;
}
.cta.disabled {
  cursor: not-allowed;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
  border-style: dashed;
}
.cta.disabled:hover {
  border-color: var(--vp-c-border);
}
.badge {
  position: absolute;
  top: -12px;
  left: 24px;
  background: var(--vp-c-text-2);
  color: var(--vp-c-bg);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 10px;
  border-radius: 999px;
  max-width: calc(100% - 48px);
}
.name {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 20px;
  line-height: 1.3;
  letter-spacing: 0;
}
.audience {
  line-height: 1.45;
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  min-height: 2.6em;
}
.price {
  line-height: 1.2;
  margin: 12px 0 4px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}
.amount {
  font-size: 34px;
  font-weight: 800;
  color: var(--vp-c-text-1);
}
.from,
.unit {
  line-height: 1.4;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.summary {
  margin: 8px 0 12px;
  font-size: 14px;
  line-height: 1.5;
}
.card ul {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  flex: 1;
  font-size: 14px;
  line-height: 1.5;
}
.card li {
  position: relative;
  padding-left: 22px;
  margin: 6px 0;
}
.card li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.5em;
  width: 6px;
  height: 11px;
  border: solid var(--vp-c-brand-1);
  border-width: 0 2px 2px 0;
  transform: translateY(-50%) rotate(45deg);
}
.cta {
  display: block;
  text-align: center;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
}
.cta:hover {
  border-color: var(--vp-c-brand-1);
}
.table-wrap {
  overflow: auto;
  max-height: 80vh;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  margin: 16px 0;
}
table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  min-width: 760px;
  margin: 0;
  display: table;
  font-size: 13px;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vp-c-bg-soft);
  text-align: center;
  white-space: nowrap;
}
thead th:first-child,
tbody th[scope="row"] {
  position: sticky;
  left: 0;
  text-align: left;
  background: var(--vp-c-bg);
  min-width: 190px;
}
thead th:first-child {
  z-index: 3;
  background: var(--vp-c-bg-soft);
}
td,
th {
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--vp-c-divider);
}
td {
  text-align: center;
}
td.none {
  color: var(--vp-c-text-3);
}
tr.section th {
  position: static;
  background: var(--vp-c-bg-alt);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  text-align: left;
}
</style>
