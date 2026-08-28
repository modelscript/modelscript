# Contributing to ModelScript

## Development Setup

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
npm run build
```

### Prerequisites

- **Node.js** ≥ 22 (see `.nvmrc`)
- **emsdk** — required for building the Tree-sitter WASM parser (see [README](./README.md#prerequisites))

### Common Commands

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `npm run dev`    | Start all services (API, Morsel, Web, IDE) |
| `npm run build`  | Build all packages                         |
| `npm test`       | Run tests                                  |
| `npm run lint`   | Run linters                                |
| `npm run format` | Format with Prettier                       |

## Making a Release

Releases are triggered manually via GitHub Actions. The workflow versions all publishable packages, generates changelogs, and publishes to all registries.

### 1. Configure Secrets

The following secrets must be set in **Settings → Secrets and variables → Actions**:

| Secret       | Source                                                          | Purpose                                                                                  |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `NPM_TOKEN`  | [npmjs.com](https://www.npmjs.com/settings/~/tokens)            | Publish `@modelscript/language`, `@modelscript/cli`, `@modelscript/tree-sitter-modelica` |
| `VSCE_PAT`   | [Azure DevOps](https://dev.azure.com/) → Personal access tokens | Publish VS Code extension to Marketplace                                                 |
| `OVSX_PAT`   | [open-vsx.org](https://open-vsx.org/user-settings/tokens)       | Publish VS Code extension to Open VSX                                                    |
| `DEPLOY_PAT` | GitHub → Personal access tokens (classic)                       | Push version commits and tags back to the repo                                           |

### 2. Trigger the Release

1. Go to **Actions** → **Release** → **Run workflow**
2. Select the version bump type:
   - `patch` — bug fixes (0.0.**x**)
   - `minor` — new features (0.**x**.0)
   - `major` — breaking changes (**x**.0.0)
   - `prepatch` / `preminor` / `premajor` — pre-release versions
3. Check **"Is this the first release?"** if there are no existing tags
4. Click **Run workflow**

### 3. What the Release Does

The workflow runs these steps in order:

1. **Build, Test, Lint** — ensures main is healthy
2. **Version & Changelog** — bumps versions using [conventional commits](https://www.conventionalcommits.org/), generates changelogs, creates a GitHub Release
3. **Publish to npm** — `@modelscript/language`, `@modelscript/cli`, `@modelscript/tree-sitter-modelica`
4. **Publish VS Code Extension** — packages VSIX, publishes to VS Code Marketplace and Open VSX
5. **Publish Docker Images** — builds and pushes to GHCR (`ghcr.io/modelscript/*`) with `:latest` and `:version` tags
6. **Push tags** — pushes version commits and git tags back to the repo

### Dry Run

To preview what a release would do without publishing:

```bash
npm run release:dry-run
```

## CI/CD

Every push to `main` and every pull request triggers the CI workflow (`.github/workflows/ci.yml`), which:

- Builds all packages
- Runs tests
- Runs linters
- Packages the VS Code extension (VSIX artifact)
- Deploys Morsel and IDE to GitHub Pages (main only)
- Builds and pushes Docker images to GHCR as `:latest` (main only)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) — the release workflow uses them to generate changelogs automatically.

```
feat: add simulation CSV export
fix: correct array dimension mismatch in flattener
docs: update CLI usage examples
refactor: simplify DAE printer ordering
```
