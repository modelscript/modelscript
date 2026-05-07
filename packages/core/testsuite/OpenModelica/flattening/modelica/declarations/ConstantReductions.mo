// name:     ConstantReductions
// keywords: declaration
// status:   correct
//
// Constant evaluation of reductions.
//

class ConstantReductions
  Real x1, x2, x3, x4;
  Real v[5];
  Real v2[2];
  String s;
  Integer arr[5];
equation
  x1 = sum(i * 3 for i in {1,3,4,5});
  x2 = min(i for i in 1:5);
  x3 = max(i - 3 for i in 1:4);
  x4 = product(i for i in 1:5);
  v = {product(j for j in 1:i) for i in 0:4};
  v2 = sum(j for j in {{1,2},{3,4}});
  s = sum(i for i in {"Hello", " ", "world", "!"});
  arr = {i for i in 1:5};
end ConstantReductions;

// Result:
// Error processing file: ConstantReductions.mo
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:9:3-9:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:10:3-10:12:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:11:3-11:13:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:12:3-12:11:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:13:3-13:17:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:15:3-15:37:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ConstantReductions.mo:20:3-20:37:writable] Error: Type error in iteration range '{{1, 2}, {3, 4}}'. Expected array got Integer[2, 2].
// Error: Error occurred while flattening model ConstantReductions
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
