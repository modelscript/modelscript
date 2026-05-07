// name:     SubScript2
// keywords: SubScript simplifications
// status:   correct
//
// Check that subscripts are simplified correctly.
//

model Subscript2
  Real x[3];
  Real y[3,2];
  Real y2[2,3];
  Real s,t;

equation
 s = x[:]*y[:,1];
 t = x*y2[2,:];
end Subscript2;


// Result:
// Error processing file: SubScript2.mo
// Error: Failed to load package SubScript2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SubScript2 not found in scope <top>.
// Error: Error occurred while flattening model SubScript2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
