// name: Constant12
// status: correct

class A
  class B
  Real z = A.y;
  end B;
  constant Real y;
  B[3] b;
end A;

class Constant12
  A[2] a(y = {1,2});
end Constant12;

// Result:
// Error processing file: Constant12.mo
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:6:3-6:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:8:3-8:18:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:9:3-9:9:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:13:3-13:20:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:6:3-6:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:8:3-8:18:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:9:3-9:9:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:8:3-8:18:writable] Notification: From here:
// [OpenModelica/flattening/modelica/declarations/Constant12.mo:6:3-6:15:writable] Error: Constant A.y is used without having been given a value.
// Error: Error occurred while flattening model Constant12
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
