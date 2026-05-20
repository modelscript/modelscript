# Fault Propagation Analysis (FMEA)

This example demonstrates how the OWL2 reasoner traces **fault propagation paths**
through a system's connection topology using transitive closure of the
`isConnectedTo` object property.

## Scenario

A simple control system has a sensor, controller, and actuator connected in series.
When asked "what components are affected if `sensor1` fails?", the reasoner
computes the transitive closure of `isConnectedTo` to find all reachable nodes.

## Files

- `control_system.mo` — Modelica model with connect() statements
- `fault_taxonomy.owl` — OWL2 ontology with fault modes and propagation rules

## Expected Behavior

1. `trace_fault_propagation("mo:sensor1")` returns `[mo:controller1, mo:actuator1, mo:plant1]`
2. `validate_system_consistency` confirms no contradictions
3. `explain_inference("mo:sensor1", "mo:FaultPropagationTarget")` shows the chain
