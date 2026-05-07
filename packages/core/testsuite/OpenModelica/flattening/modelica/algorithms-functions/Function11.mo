// name:     Function11
// keywords: function, default values
// status:   correct
//
// This tests default values for function arguments.


function equal
 input Real x[:];
 input Real y[:];
 input Real eps=1e-6;
 output Boolean equal;
algorithm
 equal := false;
end equal;

model test
  Real x[2],y[2]={1,2};
  Boolean b;
equation
x=y;
b = equal(x,y);
end test;

// Result:
// Error processing file: Function11.mo
// Error: Failed to load package Function11 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Function11 not found in scope <top>.
// Error: Error occurred while flattening model Function11
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
