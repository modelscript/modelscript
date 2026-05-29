// name: IfExpression13
// keywords:
// status: correct
//

record R
  constant Boolean cond = false;
  constant Real[3] a = if cond then {1.0} else {1.0, 2.0, 3.0};
  constant Real[2] b = a[1:end-1];
end R;

model IfExpression13
  R r = R();
end IfExpression13;

// Result:
// Error processing file: IfExpression13.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/IfExpression13.mo:13:3-13:12:writable] Error: No matching function found for R().
// Candidates are:
//   R(Boolean cond = false, Real[3] a = if cond then {1.0} else {1.0, 2.0, 3.0}, Real[2] b = a[1:end - 1]) => R
//
// Execution failed!
// endResult
