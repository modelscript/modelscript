// status: correct

model EvalUnknownDim
  function mySize
    input Real r[:];
    output Integer s;
  protected
    Real tmp[:];
  algorithm
    tmp := r;
    s := size(tmp,1);
  end mySize;
  constant Integer s = mySize({1,2,3});
end EvalUnknownDim;
// Result:
// Error processing file: EvalUnknownDim.mo
// Error: Failed to load package mySize (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mySize not found in scope <top>.
// Error: Error occurred while flattening model mySize
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
