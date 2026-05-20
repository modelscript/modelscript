# Automated Component Selection via Subsumption

This example demonstrates how OWL2 **subsumption reasoning** can automatically
identify which Modelica components satisfy a set of requirements.

## Scenario

A SysML v2 requirement specifies that the system needs a "high-voltage actuator"
(defined as a subclass of `Actuator` with voltage > 200V). The OWL2 reasoner
uses subsumption to find all Modelica components that match.

## Files

- `components.mo` — Modelica library with various actuator types
- `requirements.sysml` — SysML v2 requirement for high-voltage actuator
- `taxonomy.owl` — OWL2 ontology defining the actuator hierarchy

## Expected Behavior

1. `query_ontology_sparql("subclasses(mo:Actuator)")` returns `[mo:ServoMotor, mo:StepperMotor, mo:LinearActuator]`
2. `query_ontology_sparql("instances(mo:HighVoltageActuator)")` returns `[mo:ServoMotor]` — only the servo meets the voltage constraint
