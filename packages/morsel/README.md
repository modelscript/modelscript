<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# Morsel: Visual Modelica Editor

Morsel (`@modelscript/morsel`) is a modern, web-based visual editor for Modelica, built with React and React Router. It provides an intuitive interface for designing, analyzing, and editing Modelica models.

## Features

- **Interactive Diagrams**: Visualize Modelica connections and topologies using high-performance X6-based rendering.
- **Synchronized Code Editor**: Real-time synchronization between the visual diagram and the Modelica code, powered by Monaco Editor.
- **Properties Panel**: Easily edit component parameters, modifiers, and annotations through a dedicated UI.
- **Library Navigation**: Explore complex Modelica libraries (like the Modelica Standard Library) via an hierarchical tree view.
- **Rich Aesthetics**: A premium, responsive interface designed for the best user experience.

## Getting Started

Morsel is part of the ModelScript monorepo.

### Development

To start the development server with Hot Module Replacement (HMR):

```bash
cd packages/morsel
npm run dev
```

The application will be available at `http://localhost:5173`.

### Production Build

To create an optimized production build:

```bash
npm run build
```

The output will be in the `build/` directory, separated into `client/` and `server/`.

### Running in Production

```bash
npm start
```

## Styling

Morsel uses **Tailwind CSS** and **GitHub Primer React** components for a consistent and professional look.

## License

ModelScript is licensed under the **AGPL-3.0-or-later**.
