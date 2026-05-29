// name: conngraph2.mo
// keywords:
// status: correct
//
// FAILREASON: Overconstrained types not yet recognized as such.
//

connector RealInput = input Real;

connector C
  RealInput ri;
end C;

model M
  C c1;
equation
  Connections.root(c1.ri);
end M;

// Result:
// Error processing file: conngraph2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/conngraph2.mo:17:3-17:26:writable] Error: The first argument 'c1.ri' of Connections.root must have the form A.R, where A is a connector and R an over-determined type/record.
//
// Execution failed!
// endResult
