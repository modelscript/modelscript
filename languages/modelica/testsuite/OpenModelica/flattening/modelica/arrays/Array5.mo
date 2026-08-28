// name:     Array5
// keywords: array,modification
// status:   correct
//
// This is a test of values in types.
// Note that the fill-operation is here generalized to non-scalars
// in the flat model.

model Array5
  type T1 = Real[3](start={1,0,0});
  type T2 = T1[2];
  T2 x;
  T1 y;
  T1[4] z[5];
equation
  for i in 1:4 loop
    for j in 1:5 loop
      z[j,i,:]=y;
    end for;
  end for;
  der(y)=-y;
  x={y,der(y)};
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Array5;

// flatmodel Array5
//
// Real x[2, 3](start = fill({1, 0, 0}, size(x, 1)));
// Real y[3](start = {1, 0, 0});
// Real z[5, 4, 3](start = fill({1, 0, 0}, size(z, 1), size(z, 2)));
//
//equation
//  for i in (1:4) loop
//    for j in (1:5) loop
//      z[j, i, :] = y;
//    end for;
//  end for;
//  der(y) =  -y;
//  x = {y, der(y)};

// Result:
// Error processing file: Array5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/Array5.mo:12:3-12:7:writable] Error: Variable x: Wrong type on builtin attribute start of type Integer[3], expected Real.
// Error: Error occurred while flattening model Array5
//
// Execution failed!
// endResult
