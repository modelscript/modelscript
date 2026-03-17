// name:     Function8
// keywords: function
// status:   incorrect
//
// This tests basic function functionality
//

function f
  input Real x;
  output Real r;
algorithm
  r := 2.0 * x;
end f;

model Function8
  Real x;
  String z;
equation
  x = f(z);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Function8;
// Result:
// [flattening/modelica/algorithms-functions/Function8.mo:19:9-19:10] Error: [M3006] In call to 'f': argument 'x' expects type 'Real' but got 'String'.
// endResult
