// name: CevalFuncRecord3
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
  outR.x := inR.x;
  outR.y := inR.y;
end f;

model CevalFuncRecord3
  constant R r1;
  constant R r2 = f(r1);
end CevalFuncRecord3;

// Result:
// Error processing file: CevalFuncRecord3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/CevalFuncRecord3.mo:8:3-8:9:writable] Error: Constant 'r1.x' has no value.
//
// Execution failed!
// endResult
