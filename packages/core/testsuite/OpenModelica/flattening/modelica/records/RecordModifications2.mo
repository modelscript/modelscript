// name:     RecordModifications2
// keywords: record modification #3479
// status:   correct
//
// Tests record modification propagation using very simplified models from
// Modelica.Electrical.Machines.
//

model DC_PermanentMagnet
  parameter Real wNominal;
  extends PartialBasicMachine(frictionParameters(wRef = wNominal));
end DC_PermanentMagnet;

record FrictionParameters
  parameter Real PRef = 0;
  parameter Real wRef;
end FrictionParameters;

model Friction
  Real tau;
  parameter FrictionParameters frictionParameters;
equation
  if frictionParameters.PRef <= 0 then
    tau = 0;
  else
    tau = 1;
  end if;
end Friction;

partial model PartialBasicMachine
  parameter FrictionParameters frictionParameters;
  Friction friction(final frictionParameters = frictionParameters);
end PartialBasicMachine;

model RecordModifications2
  DC_PermanentMagnet dcpm2(wNominal = wNominal, frictionParameters = frictionParameters);
  parameter Real wNominal = 2850;
  parameter FrictionParameters frictionParameters(PRef = 100);
end RecordModifications2;

// Result:
// Error processing file: RecordModifications2.mo
// [OpenModelica/flattening/modelica/records/RecordModifications2.mo:16:3-16:22:writable] Error: Parameter frictionParameters.wRef has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model RecordModifications2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
