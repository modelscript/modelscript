// name:     Simplify2
// keywords: simplify
// status:   correct
//
// Checks that expressions are not lost in simplify.
//

function foo
   input Real x[3];
   output Real y[3];
   annotation(derivative(noDerivative=x)= dfoo);
algorithm
   y := x;
end foo;

function dfoo
   input Real x[3];
   output Real y[3];
algorithm
   y := x;
end dfoo;


model Test
   Real x(start=0);
   parameter Real x_end=5;
   Real m[3];
equation
   m[1] = x+1.0;
   m[3] = x+2.0;
   4 = der(foo(m)*{0,1,0}+x);
   der(x) + x = x_end;
end Test;

// Result:
// Error processing file: Simplify2.mo
// Error: Failed to load package Simplify2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Simplify2 not found in scope <top>.
// Error: Error occurred while flattening model Simplify2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
