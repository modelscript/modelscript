# Semantic Unit Verification

This example demonstrates how OWL2 reasoning can catch **dimensional analysis errors**
by encoding SI unit constraints as class restrictions and verifying that connected
ports have compatible units.

## Scenario

A model connects a pressure sensor output (in Pascals) to a temperature controller
input (expecting Kelvins). The OWL2 ontology encodes unit compatibility constraints,
and the reasoner detects the mismatch as a class assertion violation.

## Files

- `units_model.mo` — Modelica model with a deliberate unit mismatch
- `unit_ontology.owl` — OWL2 ontology with SI unit hierarchy and compatibility rules

## Expected Behavior

1. `validate_system_consistency` detects inconsistency
2. The conflict involves `mo:pressureSensor` being asserted as producing `unit:Pascal`
   connected to a port expecting `unit:Kelvin`
3. `DisjointClasses(unit:PressureUnit unit:TemperatureUnit)` triggers the violation
