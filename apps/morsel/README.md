<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/morsel

Visual Modelica editor and diagram viewer. Built with React, React Router, Monaco Editor, and AntV X6.

## Features

- **Monaco Code Editor** — syntax and semantic highlighting for Modelica with auto-formatting
- **Interactive Diagrams** — drag-and-drop component diagrams powered by AntV X6 with automatic layout
- **Simulation** — run simulations directly in the browser with configurable experiment parameters
- **Results Plotting** — interactive time-series plots of simulation results
- **Component Tree** — hierarchical navigation of Modelica class structures
- **Modelica Standard Library** — bundled MSL 4.1.0 with full resolution and completions
- **Diagram Editing** — move components with automatic Placement annotation management

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run build`     | Build with React Router              |
| `npm run dev`       | Start development server (port 3002) |
| `npm run start`     | Serve production build               |
| `npm run typecheck` | Type generation and TypeScript check |

## Running

```bash
npm run dev
```

The editor starts on http://localhost:3002.

## Docker

```bash
docker compose up morsel
```

Exposes port **3002**.
