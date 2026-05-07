// name:     SmallLinsys
// keywords:
// status:   correct
//

model LinSys
  Real x(start=1);
  Real y(start=2);
  Real z(start=3);
equation
   der(x) + z*der(y) + der(z) = 1;
   z*der(y)-x*der(z) = 3;
   der(z)+der(x)-x*der(y) = 1;
end LinSys;

// Result:
// Error processing file: SmallLinsys.mo
// Error: Failed to load package SmallLinsys (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SmallLinsys not found in scope <top>.
// Error: Error occurred while flattening model SmallLinsys
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
