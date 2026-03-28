<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/web

Web frontend for browsing and exploring Modelica libraries. Built with React and Vite.

## Features

- **Library Browser** — npm-style package pages for published Modelica libraries
- **Class Tree** — hierarchical navigation of Modelica package structures
- **Documentation Rendering** — display Modelica model documentation and descriptions
- **Global Search** — search across all published libraries and classes
- **SVG Diagrams** — rendered component diagrams for each class

## Scripts

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `npm run build`   | Type-check and build with Vite    |
| `npm run dev`     | Start Vite dev server (port 3001) |
| `npm run lint`    | Run ESLint                        |
| `npm run preview` | Preview production build          |

## Running

```bash
npm run dev
```

The web app starts on http://localhost:3001.

## Docker

```bash
docker compose up web
```

Exposes port **3001**.
