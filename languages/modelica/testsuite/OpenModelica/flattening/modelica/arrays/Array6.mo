// name:     Array6
// keywords: array, modification
// status:   correct
//
// This demonstrates advanced use of modifiers in types.
// Note that fill is generalized to take non-scalars in the flat model.
model Array6
  type T1 = Real[3](start={1,0,0});
  type T2 = T1[2];
  T2 x;
  T1 y;
  type T3 = T2 (start=[1,0,0;2,3,4]);
  T3[1] w;
  T1[4,5] z[1,2];
equation
  for i in 1:4 loop
    for j in 1:5 loop
      z[:,:,i,j,:]=w;
    end for;
  end for;
  w={x};
  der(y)=-y;
  x={y,der(y)};
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Array6;

// flatmodel Array6
//
// Real x[2, 3](start = fill({1, 0, 0}, size(x, 1)));
// Real y[3](start = {1, 0, 0});
// Real w[1, 2, 3](start = fill([1, 0, 0; 2, 3, 4], size(w, 1)));
// Real z[1, 2, 4, 5, 3](start = fill({1, 0, 0},
//  size(z, 1), size(z, 2), size(z, 3), size(z, 4)));
//equation
//  for i in 1:4 loop
//    for j in 1:5 loop
//      z[:,:,i,j,:]=w;
//    end for;
//  end for;
//  w={x};
//  der(y)=-y;
//  x={y,der(y)};

// Result:
// Error processing file: Array6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/Array6.mo:10:3-10:7:writable] Error: Variable x: Wrong type on builtin attribute start of type Integer[3], expected Real.
// Error: Error occurred while flattening model Array6
//
// Execution failed!
// endResult
