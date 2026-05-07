// name: CevalRecord8
// keywords:
// status: incorrect
//
// Checks that the division by zero error is shown when in a record.
//

record R
  parameter Real x[:];
end R;

record R2
  parameter Real x;
end R2;

function f
  input R r;
  output R2 r2;
algorithm
  r2.x := if max(r.x) < 0 then 0 else 1;
end f;

model CevalRecord8
  parameter R r(x = 1/0*{0, 1, 2});
  parameter R2 r2 = f(r) annotation(Evaluate=true);
end CevalRecord8;

// Result:
// Error processing file: CevalRecord8.mo
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2580:20-2580:78:writable] Error: Internal error NFCeval.evalBuiltinMax got invalid arguments (#EMPTY#)
// Error: Error occurred while flattening model CevalRecord8
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
