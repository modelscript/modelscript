// name: FunctionVariability
// keywords: function variability
// status: incorrect

function f
  constant input Real x;
  output Real y;
algorithm
  y := x;
end f;

model FunctionVariability
  Real a, b = f(a);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end FunctionVariability;

// Result:
// [flattening/modelica/algorithms-functions/FunctionVariability.mo:13:17-13:18] Error: [M4012] Function argument x=a in call to f has variability continuous which is not a constant expression.
// endResult
