// name: inst7.mo
// keywords:
// status: incorrect
//
//


model M
  Real x(start = 2.0);
  Real y = x.start;
end M;

// Result:
// Error processing file: inst7.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/inst7.mo:10:3-10:19:writable] Error: Variable start not found in scope x.
//
// Execution failed!
// endResult
