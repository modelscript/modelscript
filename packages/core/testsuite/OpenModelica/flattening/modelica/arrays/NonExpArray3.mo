// name:     Non-expanded Array3
// keywords: array
// status:   correct
//
// A test of non-expanded arrays for the case of array containing arrays with bindings.
//

model Array3
  type B = Real[3];

  class A
    Real[3] x;
    B y;
  end A;

  A[2] a (x = {{1,2,3},{4,5,6}}, y = {{1,2,3},{4,5,6}});
  annotation(__OpenModelica_commandLineOptions="+a -d=-newInst");
end Array3;

// Result:
// Error processing file: NonExpArray3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/NonExpArray3.mo:16:11-16:32:writable] Error: Type mismatch in modifier of component a[2].x, expected type Real, got modifier ={{1, 2, 3}, {4, 5, 6}} of type Integer[2, 3].
// Error: Error occurred while flattening model Array3
//
// Execution failed!
// endResult
