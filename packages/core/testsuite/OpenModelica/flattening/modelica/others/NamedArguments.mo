// name:     NamedArguments
// keywords: function named arguments
// status:   correct
//
// Test different ways of calling a function with named and positional arguments.
//

function foo
  input Real x;
  input Real y;
  output Real z;
algorithm
  z:=x+y;
end foo;

model test
  Real w,v;
  Real x=foo(2,y=w);
  Real y=foo(x=v,y=w);
  Real z=foo(y=v,x=w);
  Real z2=foo(w,v);
end test;


// Result:
// Error processing file: NamedArguments.mo
// Error: Failed to load package NamedArguments (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class NamedArguments not found in scope <top>.
// Error: Error occurred while flattening model NamedArguments
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
