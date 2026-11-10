// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — BFO 2020 (ISO/IEC 21838-2) and IOF Core Ontological Vocabulary.
 *
 * Provides standardized top-level and mid-level ontology definitions, IRIs, and
 * core foundational axioms for cyber-physical systems engineering.
 */

import type { OWL2Axiom } from "./wasm_ontology.js";

export const BFO = {
  Entity: "bfo:Entity",
  Continuant: "bfo:Continuant",
  Occurrent: "bfo:Occurrent",
  IndependentContinuant: "bfo:IndependentContinuant",
  SpecificallyDependentContinuant: "bfo:SpecificallyDependentContinuant",
  GenericallyDependentContinuant: "bfo:GenericallyDependentContinuant",
  MaterialEntity: "bfo:MaterialEntity",
  ImmaterialEntity: "bfo:ImmaterialEntity",
  Site: "bfo:Site",
  SpatialRegion: "bfo:SpatialRegion",
  Quality: "bfo:Quality",
  RealizableEntity: "bfo:RealizableEntity",
  Role: "bfo:Role",
  Disposition: "bfo:Disposition",
  Function: "bfo:Function",
  Process: "bfo:Process",
  ProcessBoundary: "bfo:ProcessBoundary",
  TemporalRegion: "bfo:TemporalRegion",
  SpatiotemporalRegion: "bfo:SpatiotemporalRegion",
} as const;

export const IOF = {
  MaterialArtifact: "iof:MaterialArtifact",
  EngineeredSystem: "iof:EngineeredSystem",
  Component: "iof:Component",
  Assembly: "iof:Assembly",
  SystemInterface: "iof:SystemInterface",
  Port: "iof:Port",
  Pin: "iof:Pin",
  Flange: "iof:Flange",
  Terminal: "iof:Terminal",
  DesignSpecification: "iof:DesignSpecification",
  RequirementSpecification: "iof:RequirementSpecification",
  Capability: "iof:Capability",
  ActuatorFunction: "iof:ActuatorFunction",
  SensorFunction: "iof:SensorFunction",
  PowerSupplyFunction: "iof:PowerSupplyFunction",
  TransportFunction: "iof:TransportFunction",
} as const;

export const RELATIONS = {
  has_participant: "ro:has_participant",
  has_part: "ro:has_part",
  part_of: "ro:part_of",
  bearer_of: "ro:bearer_of",
  inheres_in: "ro:inheres_in",
  specifically_depends_on: "ro:specifically_depends_on",
  generically_depends_on: "ro:generically_depends_on",
  occupies_temporal_region: "bfo:occupies_temporal_region",
  occupies_spatial_region: "bfo:occupies_spatial_region",
  connected_to: "iof:connected_to",
  prescribed_by: "cco:is_prescribed_by",
} as const;

/**
 * Returns the foundational, mathematically proven axioms of BFO 2020 and IOF Core,
 * including top-level taxonomical subsumptions and core disjointness constraints.
 */
export function getBfoIofCoreAxioms(): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [
    // 1. Declarations: Top-level Continuant / Occurrent
    { type: "ClassDeclaration", iri: BFO.Entity, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Continuant, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Occurrent, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Continuant, superClassIri: BFO.Entity, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Occurrent, superClassIri: BFO.Entity, sourceLang: "bfo" },

    // BFO Axiom 1: Continuant and Occurrent are strictly disjoint
    {
      type: "DisjointClasses",
      classIris: [BFO.Continuant, BFO.Occurrent],
      sourceLang: "bfo",
    },

    // 2. Declarations: Continuant branches
    { type: "ClassDeclaration", iri: BFO.IndependentContinuant, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.SpecificallyDependentContinuant, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.GenericallyDependentContinuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.IndependentContinuant, superClassIri: BFO.Continuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.SpecificallyDependentContinuant, superClassIri: BFO.Continuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.GenericallyDependentContinuant, superClassIri: BFO.Continuant, sourceLang: "bfo" },

    // BFO Axiom 2: Disjointness among Continuant categories
    {
      type: "DisjointClasses",
      classIris: [BFO.IndependentContinuant, BFO.SpecificallyDependentContinuant, BFO.GenericallyDependentContinuant],
      sourceLang: "bfo",
    },

    // 3. Declarations: Independent Continuant (Material vs Immaterial)
    { type: "ClassDeclaration", iri: BFO.MaterialEntity, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.ImmaterialEntity, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Site, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.SpatialRegion, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.MaterialEntity, superClassIri: BFO.IndependentContinuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.ImmaterialEntity, superClassIri: BFO.IndependentContinuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Site, superClassIri: BFO.ImmaterialEntity, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.SpatialRegion, superClassIri: BFO.ImmaterialEntity, sourceLang: "bfo" },

    {
      type: "DisjointClasses",
      classIris: [BFO.MaterialEntity, BFO.ImmaterialEntity],
      sourceLang: "bfo",
    },

    // 4. Declarations: Specifically Dependent Continuant (Quality vs RealizableEntity)
    { type: "ClassDeclaration", iri: BFO.Quality, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.RealizableEntity, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Role, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Disposition, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.Function, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Quality, superClassIri: BFO.SpecificallyDependentContinuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.RealizableEntity, superClassIri: BFO.SpecificallyDependentContinuant, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Role, superClassIri: BFO.RealizableEntity, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Disposition, superClassIri: BFO.RealizableEntity, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Function, superClassIri: BFO.RealizableEntity, sourceLang: "bfo" },

    {
      type: "DisjointClasses",
      classIris: [BFO.Quality, BFO.RealizableEntity],
      sourceLang: "bfo",
    },

    // 5. Declarations: Occurrent categories
    { type: "ClassDeclaration", iri: BFO.Process, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.TemporalRegion, sourceLang: "bfo" },
    { type: "ClassDeclaration", iri: BFO.SpatiotemporalRegion, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.Process, superClassIri: BFO.Occurrent, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.TemporalRegion, superClassIri: BFO.Occurrent, sourceLang: "bfo" },
    { type: "SubClassOf", subClassIri: BFO.SpatiotemporalRegion, superClassIri: BFO.Occurrent, sourceLang: "bfo" },

    {
      type: "DisjointClasses",
      classIris: [BFO.Process, BFO.TemporalRegion, BFO.SpatiotemporalRegion],
      sourceLang: "bfo",
    },

    // 6. IOF Core Engineering Systems Subsumptions
    { type: "ClassDeclaration", iri: IOF.MaterialArtifact, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.EngineeredSystem, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Component, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Assembly, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.MaterialArtifact, superClassIri: BFO.MaterialEntity, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.EngineeredSystem, superClassIri: IOF.MaterialArtifact, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Component, superClassIri: IOF.MaterialArtifact, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Assembly, superClassIri: IOF.EngineeredSystem, sourceLang: "iof" },

    // 7. IOF Core Interfaces & Boundaries
    { type: "ClassDeclaration", iri: IOF.SystemInterface, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Port, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Pin, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Flange, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.Terminal, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.SystemInterface, superClassIri: BFO.Site, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Port, superClassIri: IOF.SystemInterface, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Pin, superClassIri: IOF.Port, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Flange, superClassIri: IOF.Port, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.Terminal, superClassIri: IOF.Port, sourceLang: "iof" },

    // 8. IOF Specifications & Requirements
    { type: "ClassDeclaration", iri: IOF.DesignSpecification, sourceLang: "iof" },
    { type: "ClassDeclaration", iri: IOF.RequirementSpecification, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.DesignSpecification, superClassIri: BFO.GenericallyDependentContinuant, sourceLang: "iof" },
    { type: "SubClassOf", subClassIri: IOF.RequirementSpecification, superClassIri: BFO.GenericallyDependentContinuant, sourceLang: "iof" },

    // 9. Object Properties
    { type: "ObjectPropertyDeclaration", iri: RELATIONS.connected_to, sourceLang: "iof", characteristics: ["Symmetric"] },
    { type: "ObjectPropertyDeclaration", iri: RELATIONS.has_part, sourceLang: "ro", characteristics: ["Transitive"] },
    { type: "ObjectPropertyDeclaration", iri: RELATIONS.part_of, sourceLang: "ro", characteristics: ["Transitive"] },
    { type: "ObjectPropertyDeclaration", iri: RELATIONS.bearer_of, sourceLang: "ro" },
    { type: "ObjectPropertyDeclaration", iri: RELATIONS.has_participant, sourceLang: "ro" },
  ];

  return axioms;
}
