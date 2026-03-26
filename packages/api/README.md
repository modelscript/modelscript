<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/api

REST API server for ModelScript. Provides endpoints for package management, publishing, simulation, GraphQL, SPARQL, and RDF queries.

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run build` | Clean, lint, and compile TypeScript  |
| `npm run clean` | Remove `dist/` output                |
| `npm run dev`   | Start development server (port 3000) |
| `npm run lint`  | Run ESLint on `src/`                 |
| `npm run watch` | Compile in watch mode                |

## Running

```bash
npm run dev
```

The API server starts on http://localhost:3000.

## Endpoints

| Endpoint        | Description                                    |
| --------------- | ---------------------------------------------- |
| `/api/packages` | List, search, and manage Modelica libraries    |
| `/api/publish`  | Publish and unpublish packages                 |
| `/api/simulate` | Run simulations and return results             |
| `/api/graphql`  | GraphQL endpoint for querying library metadata |
| `/api/sparql`   | SPARQL endpoint for RDF-based queries          |
| `/api/rdf`      | RDF data export for Modelica libraries         |
| `/api/auth`     | Authentication and token management            |

## Docker

The API is available as a Docker service:

```bash
docker compose up api
```

Exposes port **3000**.
