// name: InvalidVariability2
// keywords:
// status: incorrect
//

model InvalidVariability2
  connector C = Real;

  C c1;
  parameter C c2;
equation
  connect(c2, c1);
end InvalidVariability2;

// Result:
// Error processing file: InvalidVariability2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidVariability2.mo:10:3-10:17:writable] Error: Parameter c2 has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
