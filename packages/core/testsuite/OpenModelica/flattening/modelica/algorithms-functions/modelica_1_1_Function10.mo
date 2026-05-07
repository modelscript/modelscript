// name:     modelica_1_1_Function10
// keywords: function
// status:   correct
//
// Checks that subscripts are handled in a correct manner int the component clause.
//
//

function f
  input Real a;
  input Real b;
  output Real r1;
  output Real r2;
  output Real r3;
algorithm
  r1:=a;
  r2:=b;
  r3:=a+b;
end f;


class Function10
  Real x;
  Real y;
  Real z;
equation
  (x,y,z) = f(1,2);
end Function10;

// Result:
// Error processing file: modelica_1_1_Function10.mo
// Error: Failed to load package modelica_1_1_Function10 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class modelica_1_1_Function10 not found in scope <top>.
// Error: Error occurred while flattening model modelica_1_1_Function10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
