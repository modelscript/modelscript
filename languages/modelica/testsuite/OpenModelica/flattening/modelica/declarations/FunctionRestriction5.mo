// name: FunctionRestriction5
// keywords:
// status: incorrect
//

function f
  input Real x;
  output Real y;
protected
  inner Real z;
algorithm
  y := x * z;
end f;

model FunctionRestriction5
  Real x = f(1.0);
end FunctionRestriction5;

// Result:
// Error processing file: FunctionRestriction5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/declarations/FunctionRestriction5.mo:10:3-10:15:writable] Error: Invalid prefix inner on formal parameter z.
//
// Execution failed!
// endResult
