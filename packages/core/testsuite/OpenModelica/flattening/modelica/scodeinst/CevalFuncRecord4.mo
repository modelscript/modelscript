// name: CevalFuncRecord4
// keywords:
// status: correct
//
//

record R
  Real x;
  Real y;
end R;

function f
  input R inR;
  output R outR;
algorithm
  outR := inR;
end f;

model CevalFuncRecord4
  constant R r1;
  constant R r2 = f(r1);
end CevalFuncRecord4;

// Result:
// Error processing file: CevalFuncRecord4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/CevalFuncRecord4.mo:8:3-8:9:writable] Error: Constant 'r1.x' has no value.
//
// Execution failed!
// endResult
