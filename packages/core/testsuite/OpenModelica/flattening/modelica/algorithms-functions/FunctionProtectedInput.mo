// name: FunctionProtectedInput
// status: incorrect

model FunctionProtectedInput

function fn
  protected Real r;
  input Real inR;
  output Real outR;
algorithm
  outR := inR;
end fn;

  Real r, r2;
equation
  r = fn(r2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end FunctionProtectedInput;

// Result:
// [flattening/modelica/algorithms-functions/FunctionProtectedInput.mo:8:14-8:17] Error: [M4011] Invalid protected variable inR, function variables that are input/output must be public.
// [flattening/modelica/algorithms-functions/FunctionProtectedInput.mo:9:15-9:19] Error: [M4011] Invalid protected variable outR, function variables that are input/output must be public.
// endResult
