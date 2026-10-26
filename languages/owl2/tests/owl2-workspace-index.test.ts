// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { Owl2WorkspaceIndex } from "../src/workspace-index.js";

const foundationOntology = `
Prefix(: = <http://example.org/foundation#>)
Prefix(owl: = <http://www.w3.org/2002/07/owl#>)

Ontology(<http://example.org/foundation>
  Declaration(Class(:Entity))
  Declaration(Class(:System))
  Declaration(ObjectProperty(:hasComponent))
  Declaration(DataProperty(:identifier))
)
`;

const droneOntology = `
Prefix(: = <http://example.org/drone#>)
Prefix(f: = <http://example.org/foundation#>)

Ontology(<http://example.org/drone>
  Import(<http://example.org/foundation>)

  Declaration(Class(:Quadcopter))
  Declaration(Class(:Rotor))
  Declaration(ObjectProperty(:hasRotor))
  Declaration(DataProperty(:maxThrust))
  Declaration(NamedIndividual(:drone_alpha))

  SubClassOf(:Quadcopter f:System)
  SubClassOf(:Rotor f:Entity)
)
`;

test("OWL2 WorkspaceIndex: Indexes ontologies, classes, properties, individuals, and imports", () => {
  const ws = new Owl2WorkspaceIndex();
  assert.equal(ws.version, 1);
  assert.equal(ws.fileCount, 0);

  // 1. Index foundation ontology
  const foundIdx = ws.indexFile("file:///workspace/foundation.ofn", foundationOntology);
  assert.equal(ws.fileCount, 1);
  assert.equal(ws.getOntologyIri("file:///workspace/foundation.ofn"), "http://example.org/foundation");
  assert.ok(foundIdx.byName.has("Entity"));
  assert.ok(foundIdx.byName.has("System"));
  assert.ok(foundIdx.byName.has("hasComponent"));
  assert.ok(foundIdx.byName.has("identifier"));

  // 2. Index drone ontology
  const droneIdx = ws.indexFile("file:///workspace/drone.ofn", droneOntology);
  assert.equal(ws.fileCount, 2);
  assert.equal(ws.getOntologyIri("file:///workspace/drone.ofn"), "http://example.org/drone");
  assert.ok(droneIdx.byName.has("Quadcopter"));
  assert.ok(droneIdx.byName.has("drone_alpha"));

  // Verify imports
  const imports = ws.getImports("file:///workspace/drone.ofn");
  assert.equal(imports.length, 1);
  assert.equal(imports[0], "http://example.org/foundation");

  // 3. Resolve local entities
  const droneClass = ws.resolveEntity("Quadcopter", "file:///workspace/drone.ofn");
  assert.ok(droneClass);
  assert.equal(droneClass.name, "Quadcopter");
  assert.equal(droneClass.kind, "Class");

  const indiv = ws.resolveEntity("drone_alpha", "file:///workspace/drone.ofn");
  assert.ok(indiv);
  assert.equal(indiv.name, "drone_alpha");
  assert.equal(indiv.kind, "Individual");

  // 4. Resolve imported entities across ontologies
  const importedSystem = ws.resolveEntity("System", "file:///workspace/drone.ofn");
  assert.ok(importedSystem);
  assert.equal(importedSystem.name, "System");
  assert.equal(importedSystem.namePath, "http://example.org/foundation#System");

  const importedProp = ws.resolveEntity("hasComponent", "file:///workspace/drone.ofn");
  assert.ok(importedProp);
  assert.equal(importedProp.kind, "ObjectProperty");

  // 5. Verify unified symbol index
  const unified = ws.toUnified();
  assert.ok(unified.byName.has("Entity"));
  assert.ok(unified.byName.has("Quadcopter"));
  assert.ok(unified.symbols.size >= 8);
});
