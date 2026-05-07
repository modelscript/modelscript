// name: ArrayAssignWholeDim
// keywords: slice array assign
// status: correct
//
// Fix for bugs in c_runtime/real_array.c indexed_assign_real_array() and index_real_array()
// Should be moved to mosfiles to ensure c-runtime invocation

model ArrayAssignWholeDim
  function GetA
       input Real[:] x;
       output Real[size(x,1),4] a;
     algorithm
        a[:,1] := x; //just to trigger compilation and usage of the indexed_assign_real_array()
        a[1,:] := { 10, 20, 30, 40 }; //here was the bug in indexed_assign_real_array()
        a[size(x,1), :] := { 0.1, 0.2, 0.3, 0.4 }; //and here
        a[2:3,2] := x[2:3];  //and another one in index_real_array()
  end GetA;
  constant Real X[:] = {1,2,3,4,5};
  constant Real A[:,4] = GetA(X);
end ArrayAssignWholeDim;

// Result:
// Error processing file: ArrayAssignWholeDim.mo
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFExpression.mo:2487:11-2487:118:writable] Error: Internal error NFExpression.toDAE got unknown expression '#EMPTY#'
// Error: Error occurred while flattening model ArrayAssignWholeDim
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
