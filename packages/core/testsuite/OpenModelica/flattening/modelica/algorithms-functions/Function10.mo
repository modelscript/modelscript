// name:     Function10
// keywords: function
// status:   correct
//
// This tests for bug in function instantiation. A function argument can have same identifier as
// function name.

function foo
  input Real x;
  output Real foo;
  external "C";
end foo;

model test
  Real x=foo(time);
end test;

// Result:
// Error processing file: Function10.mo
// Error: Failed to load package Function10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Function10 not found in scope <top>.
// Error: Error occurred while flattening model Function10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
