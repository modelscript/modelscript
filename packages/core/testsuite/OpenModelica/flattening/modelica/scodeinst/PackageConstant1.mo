// name: PackageConstant1
// keywords:
// status: correct
//

package P
  constant Real x1 = 1.0;
  constant Real x2 = 2.0;
  constant Real x3 = 3.0;
  constant Real x4 = 4.0;
  constant Real x5 = 5.0;
  constant Real x6 = 6.0;
end P;

function f
  input Real x = P.x5;
  output Real y;
algorithm
  y := x * P.x6;
end f;

model PackageConstant2
  Real y = P.x1;
  Real z;
equation
  z = P.x2;
algorithm
  z := P.x3;
  f(1.0);
end PackageConstant2;

// Result:
// Error processing file: PackageConstant1.mo
// Error: Failed to load package PackageConstant1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class PackageConstant1 not found in scope <top>.
// Error: Error occurred while flattening model PackageConstant1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
