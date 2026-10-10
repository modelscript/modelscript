// name: InvalidVariability1
// keywords:
// status: incorrect
//

model InvalidVariability1
  connector C = Real;

  C c1;
  parameter C c2;
equation
  connect(c1, c2);
end InvalidVariability1;

// Result:
// Error processing file: InvalidVariability1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidVariability1.mo:10:3-10:17:writable] Error: Parameter c2 has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
