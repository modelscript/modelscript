// name:     Function7
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

model Function7
  String x;
  Real z;
equation
  x = f(z);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Function7;
// Result:
// [flattening/modelica/algorithms-functions/Function7.mo:19:3-19:4] Error: [M3007] Function 'f' returns type 'Real' but 'String' expected.
// endResult
