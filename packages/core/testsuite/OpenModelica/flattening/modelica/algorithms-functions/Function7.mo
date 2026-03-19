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
// Error processing file: Function7.mo
// [flattening/modelica/algorithms-functions/Function7.mo:19:3-19:11:writable] Error: Function 'f' returns type 'Real' but 'String' expected.
// Error: Error occurred while flattening model Function7
// endResult
