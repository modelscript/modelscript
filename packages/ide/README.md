<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ide

Browser-based VS Code IDE for Modelica development. Hosts VS Code Web with the ModelScript extension and a GitHub FileSystemProvider for loading repositories directly from GitHub.

## Features

- **VS Code Web** — full VS Code editor experience in the browser
- **ModelScript Extension** — syntax highlighting, completions, diagnostics, formatting, and diagram view
- **GitHub Integration** — open any GitHub repository with `github.com/owner/repo` URLs
- **Project Templates** — quick-start templates (Blank Project, Bouncing Ball, RLC Circuit, Script, Notebook)
- **In-Memory Filesystem** — create and edit Modelica files without a backend

## Scripts

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run build`        | Download VS Code, build extensions + server |
| `npm run build-static` | Build a fully static deployment             |
| `npm run dev`          | Start development server (port 3200)        |
| `npm run lint`         | Run ESLint on `src/`                        |

## Running

```bash
npm run dev
```

The IDE starts on http://localhost:3200. From the landing page you can:

- Enter a GitHub repository URL to open it in the editor
- Click a project template to start a new in-memory project

## Docker

```bash
docker compose up ide
```

Exposes port **3200**.

## Architecture

The IDE consists of:

- **Express server** (`src/server.ts`) — serves VS Code Web assets, proxies GitHub API requests, and handles workbench routing
- **GitHub FS extension** (`github-fs/`) — VS Code extension providing a read-only GitHub filesystem
- **Static build** (`src/build-static.ts`) — generates a fully static site for GitHub Pages deployment at [ide.modelscript.org](https://ide.modelscript.org)
