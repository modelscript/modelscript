# Cross-Domain Contradiction Detection

This example demonstrates how the OWL2 reasoner catches **semantic contradictions**
between Modelica physical models and OWL2 domain constraints.

## Scenario

A system model defines `Motor` as both an `ElectricalDevice` and a `MechanicalDevice`.
An OWL2 ontology declares these two classes **disjoint** — a component cannot be both.

When the reasoner classifies the combined polyglot model, it detects the inconsistency
and reports the contradiction with a justification chain.

## Files

- `system.mo` — Modelica model with Motor extending both device types
- `constraints.owl` — OWL2 ontology declaring disjointness + domain constraints
- `README.md` — This file

## Expected Behavior

1. The OWL2 reasoner reports an **inconsistency** when classifying `mo:Motor`
2. The justification chain shows:
   - `SubClassOf(mo:Motor mo:ElectricalDevice)` — from Modelica extends
   - `SubClassOf(mo:Motor mo:MechanicalDevice)` — from Modelica extends
   - `DisjointClasses(mo:ElectricalDevice mo:MechanicalDevice)` — from OWL2 axiom
3. The MCP tool `validate_system_consistency` returns the conflict
