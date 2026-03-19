// name:     FunctionProtectedInput
// status:   incorrect

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
// Error processing file: FunctionProtectedInput.mo
// [flattening/modelica/algorithms-functions/FunctionProtectedInput.mo:8:3-8:17:writable] Error: Invalid protected variable inR, function variables that are input/output must be public.
// [flattening/modelica/algorithms-functions/FunctionProtectedInput.mo:8:3-8:17:writable] Error: Invalid protected variable outR, function variables that are input/output must be public.
// Error: Error occurred while flattening model FunctionProtectedInput
// endResult
