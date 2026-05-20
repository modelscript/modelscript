# Supply Chain Manufacturability

This example demonstrates how OWL2 reasoning validates that a system design
is **manufacturable** by checking whether all specified materials and processes
are available in the supply chain ontology.

## Scenario

A SysML v2 block diagram defines a drone assembly with parts that require
specific materials (titanium alloy, carbon fiber). The OWL2 ontology encodes
which materials are available from approved suppliers and which manufacturing
processes are compatible with each material.

## Files

- `drone.sysml` — SysML v2 drone assembly definition
- `supply_chain.owl` — OWL2 ontology with material/supplier/process constraints

## Expected Behavior

1. `validate_system_consistency` passes (all materials available)
2. If we add a part requiring `mat:Inconel718` (not in approved supplier list),
   the reasoner detects the gap
3. `query_ontology_sparql("subclasses(mat:MetalAlloy)")` returns all available metal alloys
4. `explain_inference("mat:TitaniumAlloy", "mat:ManufacturableMaterial")` shows
   the justification via supplier availability
