package ErrorFunctionCallNumArgs
function fn
  input Integer i;
  output String s;
algorithm
  s := String(i);
end fn;

function f0
  output String s;
algorithm
  s := fn();
end f0;
function f1
  output String s;
algorithm
  s := fn(1);
end f1;
function f2
  output String s;
algorithm
  s := fn(1,2);
end f2;

end ErrorFunctionCallNumArgs;

// Result:
// Error processing file: ErrorFunctionCallNumArgs.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/ErrorFunctionCallNumArgs.mo:1:1-25:29:writable] Error: Cannot instantiate ErrorFunctionCallNumArgs due to class specialization package.
//
// Execution failed!
// endResult
