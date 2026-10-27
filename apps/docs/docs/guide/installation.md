# Installation

ModelScript runs from the same WebAssembly compiler core across browsers, desktop IDEs, headless CI runners, and AI agent hosts. Choose the surface that matches your workflow.

---

## For Users & Engineers

### 1. Zero-Install Browser Playground & Web IDE

To explore ModelScript without installing anything locally:

- **[Interactive Playground (`/playground`)](https://modelscript.org/playground)**: Try curated multi-domain examples, inspect live GLR syntax trees, run stiff DAE simulations, and view rendered schematics directly in your browser tab.
- **Full Web Studio (`https://ide.modelscript.org`)**: Multi-file workspace explorer, dockable 2D schematic and 3D OpenCASCADE CAD viewports, requirements traceability matrix, and in-browser WebWorker compilation.

### 2. Command-Line Interface (`msx`)

The `@modelscript/cli` package installs both the `modelscript` binary and its shorthand alias `msx` for local development, simulation sweeps, formal verification, and CI/CD automation (requires **Node.js ≥ 22**):

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
2. Search for **`ModelScript`** (`modelscript.modelscript-vscode`) and click **Install**.

The extension bundles the native WebAssembly Language Server (`@modelscript/lsp`), real-time diagnostics across all 44 supported formats, interactive schematic and Bode plot panels, the 3D WebGL CAD viewer, and the DAP time-travel simulation debugger.

### 4. AI Coding Assistants & MCP Server (`@modelscript/mcp`)

Connect AI agents (Claude Code, Claude Desktop, Cursor, Windsurf, or custom orchestrators) to ModelScript's **31 deterministic engineering tools** over the Model Context Protocol:

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

### 5. Native Desktop Studio (Tauri v2)

For air-gapped networks, classified labs, or hardware-in-the-loop (HIL) benches, download the standalone native desktop application (`@modelscript/desktop`) from [GitHub Releases](https://github.com/modelscript/modelscript/releases):

- **Linux**: Standalone `.AppImage` or Debian/Ubuntu `.deb` packages.
- **macOS**: Universal Apple Silicon / Intel `.dmg` disk image.
- **Windows**: 64-bit `.msi` installer or portable `.exe`.

The desktop studio embeds offline WebAssembly GLR parsers, local SQLite artifact caching, and native serial/UDP bridges for real-time HIL testing.

### 6. Containerized Enterprise Hub & Simulation Server

Deploy the self-hosted ModelScript Hub, package registry, REST/GraphQL/SPARQL APIs, and multi-tenant MCP gateway via Docker:

```bash
# Pull official multi-architecture containers
docker pull ghcr.io/modelscript/api:latest
docker pull ghcr.io/modelscript/web:latest

# Launch backend simulation cluster and web IDE
docker compose up -d
```

See the [Platform Administration Guide](./administration.md) for Kubernetes Helm charts, Slurm HPC worker provisioning, and PostgreSQL audit-ledger setup.

---

## For Contributors & Compiler Developers

To build and hack on the ModelScript monorepo locally, install **Node.js ≥ 24** (matching `.nvmrc`) and `npm`.

### 1. Clone & Install

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
```

### 2. Build Core Compiler & Language Runtimes

ModelScript compiles its native WebAssembly GLR parsers (`parser.wasm`), AssemblyScript flattening kernels, and TypeScript packages via Nx:

```bash
npm run build:libs    # Build core compiler packages and language runtimes
npm run build         # Build all monorepo packages and applications
```

### 3. Launch Local Development Servers

```bash
npm run dev           # Start API backend, LSP workers, and Web IDE
```

---

## Next Steps

- Follow the **[Getting Started Tutorial](./getting-started.md)** to build, verify, simulate, and export your first connected multi-domain model.
- Explore **[CLI Overview](../cli/overview.md)** for global flags, environment variables, and all 41 `msx` commands.
