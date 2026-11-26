---
title: Installation & System Requirements
description: Install the ModelScript CLI (msx), VS Code extension, MCP server, or Docker containers (Federated CE & Enterprise Appliance) across Linux, macOS, and Windows.
---

# Installation

ModelScript runs from the same WebAssembly compiler core across browsers, desktop IDEs, headless CI runners, and AI agent hosts. Choose the surface that matches your workflow.

---

## For Users & Engineers

### 1. Zero-Install Ansatz & Studio

To explore ModelScript without installing anything locally:

- **[Ansatz (`/editor`)](https://ansatz.social/editor)**: Try curated multi-domain examples, inspect live GLR syntax trees, run stiff DAE simulations, and view rendered schematics directly in your browser tab.
- **[Studio (`/studio`)](https://ansatz.social/studio)**: Multi-file workspace explorer, dockable 2D schematic and 3D OpenCASCADE CAD viewports, requirements traceability matrix, and in-browser WebWorker compilation.

### 2. Command-Line Interface (`msx`)

The `@modelscript/cli` package installs both the `modelscript` binary and its shorthand alias `msx` for local development, simulation sweeps, formal verification, and CI/CD automation (requires **Node.js ≥ 24**):

```bash
# Run any command via npx without global installation
npx @modelscript/cli --help

# Or install globally for system-wide access
npm install -g @modelscript/cli
msx --version
```

#### Accelerating Repeated CLI Runs with `--daemon`

When running frequent interactive checks or pre-commit hooks, start the persistent background compiler daemon so `msx` reuses warm WebAssembly parser instances and incremental Salsa caches over a local Unix socket (`~/.modelscript/daemon.sock`):

```bash
# Start the background daemon and inspect its status
msx daemon start
msx daemon status

# Pass --daemon to any command to reuse warm workspace caches
msx lint ./models --daemon
```

### 3. VS Code Extension

The official extension turns VS Code or Cursor into a complete multi-domain modeling studio:

1. Open VS Code and open the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Search for **`ModelScript`** (`modelscript.modelscript`) and click **Install**.

The extension bundles the native WebAssembly Language Server (`@modelscript/lsp`), real-time diagnostics across all 169 documented engineering formats, interactive schematic and Bode plot panels, the 3D WebGL CAD viewer with formal verification overlays, and the DAP time-travel simulation debugger.

### 4. AI Coding Assistants & MCP Server (`@modelscript/mcp`)

Connect AI agents (Claude Code, Claude Desktop, Cursor, Windsurf, or custom orchestrators) to ModelScript's **124 static deterministic engineering tools** over the Model Context Protocol:

```bash
# Register @modelscript/mcp in Claude Code with a single command
claude mcp add modelscript -- npx -y @modelscript/mcp
```

For **Cursor** (`.cursor/mcp.json`), **Claude Desktop**, or **VS Code**, add the `stdio` server entry:

```json
{
  "mcpServers": {
    "modelscript": {
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"]
    }
  }
}
```

See the [AI Agents & MCP Workflows Guide](./ai-agents.md) for closed-loop synthesis recipes and remote SSE gateway configuration.

### 5. Offline & Air-Gapped Desktop Workflows

For air-gapped networks, classified labs, or hardware-in-the-loop (HIL) benches, use the **VS Code Extension** (`.vsix` offline bundle), the **Ansatz Web Editor PWA** (installable from Chromium/Edge with offline WASM caching), or the **Air-Gapped Intranet Appliance** container below. Standalone native desktop installers (`.AppImage`, `.dmg`, `.msi`) are planned for a future release.

### 6. Containerized Ansatz Network & Simulation Server (Community & Enterprise Editions)

Deploy a self-hosted federated Ansatz node or an air-gapped Enterprise Appliance via Docker in either **Community Edition** (`api-ce`, pure `AGPL-3.0-or-later` open-core) or **Enterprise Edition** (`api-ee` / `appliance`, with SSO/SAML, RBAC, Slurm HPC, and NERC CIP / FERC CEII compliance):

```bash
# Option A: Self-Hosted Federated Node (Community Edition — recommended)
export PUBLIC_DOMAIN=hub.example.org
export JWT_SECRET=$(openssl rand -hex 32)
docker compose -f docker-compose.federated.yml up -d

# Option B: Hardened Enterprise Intranet Appliance (air-gapped, requires MSX_LICENSE_KEY)
export MSX_LICENSE_KEY=msx_lic_...
export JWT_SECRET=$(openssl rand -hex 32)
docker compose -f ee/deploy/docker-compose.yml up -d
```

See the [Self-Hosting Guide](../ansatz/self-hosting.md) for federated node upgrades and Cloudflare Tunnels, and the [Platform Administration Guide](./administration.md) for Kubernetes manifests (`ee/deploy/kubernetes-appliance.yaml`), offline `MSX_LICENSE_KEY` provisioning, and Slurm HPC worker setup.

---

## For Contributors & Compiler Developers

To build and hack on the ModelScript monorepo locally, install **Node.js ≥ 24** (matching `.nvmrc`) and **pnpm** (via `corepack enable`).

### 1. Clone & Install

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
pnpm install
```

### 2. Build Core Compiler & Language Runtimes

ModelScript compiles its native WebAssembly GLR parsers (`parser.wasm`), AssemblyScript flattening kernels, and TypeScript packages via pnpm workspaces and Nx:

```bash
pnpm run build:libs                 # Build core compiler packages and language runtimes
pnpm run build                      # Build all monorepo packages and applications
pnpm --filter @modelscript/modelica test:unit  # Run tests for a single package
```

### 3. Launch Local Development Servers

```bash
pnpm run dev           # Start API backend, LSP workers, and Studio
```

---

## Next Steps

- Follow the **[Getting Started Tutorial](./getting-started.md)** to build, verify, simulate, and export your first connected multi-domain model.
- Explore **[CLI Overview](../cli/overview.md)** for global flags, environment variables, and all 178 registered `msx` commands.
