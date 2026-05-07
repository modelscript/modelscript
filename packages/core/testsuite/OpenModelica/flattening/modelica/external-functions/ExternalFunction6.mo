// name: ExternalFunction6
// status: correct
// teardown_command: rm -f ExternalFunction6_*

class ExternalFunction6
  function fn
    input Integer i1;
    output Integer i;
  external "C" i=myFn(i1) annotation(Include="#define myFn(X) (modelica_integer)(2*(X))");
  end fn;

  constant Integer i = fn(2);
end ExternalFunction6;

// Result:
// Error processing file: ExternalFunction6.mo
// [OpenModelica/flattening/modelica/external-functions/ExternalFunction6.mo:12:3-12:29:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunction6.mo:6:3-10:9:writable] Error: External function 'myFn' could not be found in any of the given shared libraries:
// [OpenModelica/flattening/modelica/external-functions/ExternalFunction6.mo:12:3-12:29:writable] Error: Failed to evaluate function: ExternalFunction6.fn.
// Error: Error occurred while flattening model ExternalFunction6
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
