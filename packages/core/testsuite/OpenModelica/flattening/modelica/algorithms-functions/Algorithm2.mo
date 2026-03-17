// name:     Algorithm2
// keywords: algorithm
// status:   incorrect
//
// Type checks in algorithms.
//

class Algorithm2
  Integer i;
  Real x;
algorithm
  i := x;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Algorithm2;
// Result:
// [flattening/modelica/algorithms-functions/Algorithm2.mo:12:3-12:10] Error: [M5006] Type mismatch in assignment in i := x of Integer := Real.
// endResult
