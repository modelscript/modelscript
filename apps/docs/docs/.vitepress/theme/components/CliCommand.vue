<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Renders the usage, actions and options of an `msx` command from
  data/cli.generated.json, which is generated from the real yargs modules
  (scripts/gen-cli-data.ts). Never hand-edit option tables; regenerate instead.
-->
<script setup lang="ts">
import { computed } from "vue";
import cliData from "../data/cli.generated.json";

interface Opt {
  name: string;
  aliases: string[];
  type?: string;
  description?: string;
  choices?: string[];
  default?: unknown;
  array?: boolean;
}
interface Cmd {
  name: string;
  specs: string[];
  aliases: string[];
  describe: string;
  positionals: Opt[];
  options: Opt[];
  subcommands: Cmd[];
}

const props = withDefaults(defineProps<{ name: string; describe?: boolean; showActions?: boolean }>(), {
  describe: false,
  showActions: true,
});

const commands = cliData as Cmd[];
const cmd = computed(() => commands.find((c) => c.name === props.name));

const actionChoices = computed(() => cmd.value?.positionals.find((p) => p.name === "action")?.choices ?? []);

function flag(o: Opt): string {
  const short = o.aliases.filter((a) => a.length === 1).map((a) => `-${a}`);
  const long = [o.name, ...o.aliases.filter((a) => a.length > 1)].map((a) => `--${a}`);
  return [...short, ...long].join(", ");
}

function typeOf(o: Opt): string {
  if (o.choices?.length) return o.choices.join(" | ");
  const t = o.type ?? (typeof o.default === "boolean" ? "boolean" : "");
  return o.array ? `${t || "string"}[]` : t;
}

function defaultOf(o: Opt): string {
  return o.default === undefined ? "" : JSON.stringify(o.default);
}

function visible(opts: Opt[]): Opt[] {
  return opts.filter((o) => o.name !== "help" && o.name !== "version");
}
</script>

<template>
  <div v-if="cmd" class="cli-cmd">
    <p v-if="describe && cmd.describe" class="cli-describe">{{ cmd.describe }}</p>

    <div class="language-bash vp-adaptive-theme">
      <span class="lang">bash</span>
      <pre><code><template v-for="(spec, i) in cmd.specs" :key="spec"><span v-if="i">{{ "\n" }}</span>msx {{ spec }}</template><template v-for="alias in cmd.aliases" :key="alias">{{ "\n" }}msx {{ alias }}{{ cmd.specs[0]?.slice(cmd.name.length) }}</template></code></pre>
    </div>

    <template v-if="cmd.subcommands.length">
      <table v-if="showActions">
        <thead>
          <tr>
            <th>Action</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sub in cmd.subcommands" :key="sub.name">
            <td>
              <code>{{ sub.name }}</code>
            </td>
            <td>{{ sub.describe }}</td>
          </tr>
        </tbody>
      </table>
      <details v-for="sub in cmd.subcommands.filter((s) => visible(s.options).length)" :key="sub.name" class="cli-sub">
        <summary>
          Options for <code>{{ cmd.name }} {{ sub.name }}</code>
        </summary>
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in visible(sub.options)" :key="o.name">
              <td>
                <code>{{ flag(o) }}</code>
              </td>
              <td>
                <code v-if="typeOf(o)">{{ typeOf(o) }}</code>
              </td>
              <td>
                <code v-if="defaultOf(o)">{{ defaultOf(o) }}</code>
              </td>
              <td>{{ o.description }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>

    <p v-else-if="showActions && actionChoices.length" class="cli-actions">
      <strong>Actions:</strong>
      <template v-for="(a, i) in actionChoices" :key="a">
        <span v-if="i">, </span><code>{{ a }}</code>
      </template>
    </p>

    <table v-if="visible(cmd.options).length">
      <thead>
        <tr>
          <th>Option</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in visible(cmd.options)" :key="o.name">
          <td>
            <code>{{ flag(o) }}</code>
          </td>
          <td>
            <code v-if="typeOf(o)">{{ typeOf(o) }}</code>
          </td>
          <td>
            <code v-if="defaultOf(o)">{{ defaultOf(o) }}</code>
          </td>
          <td>{{ o.description }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else class="warning custom-block">
    <p class="custom-block-title">Unknown command</p>
    <p>
      <code>msx {{ name }}</code> is not registered in the CLI.
    </p>
  </div>
</template>

<style scoped>
.cli-cmd table {
  display: table;
  width: 100%;
}

.cli-cmd td:first-child {
  white-space: nowrap;
}

.cli-describe {
  color: var(--vp-c-text-2);
}

.cli-sub {
  margin: 8px 0;
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.cli-sub summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--vp-c-text-2);
  padding: 6px 0;
}

.cli-sub[open] summary {
  color: var(--vp-c-text-1);
}
</style>
