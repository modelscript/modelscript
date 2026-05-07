// name:     ActivateWhenEquation
// keywords: <insert keywords here>
// status:   correct
//
// Drmodelica: 3.4 Access Control (p. 88)
//

class Activate
  constant Real x = 4;
  Real y, z;
equation
  when initial() then y = x + 3; // Equations to be activated at the beginning
  end when;
  when terminal() then z = x - 2; // Equations to be activated at the end of the simulation
  end when;
end Activate;

// Result:
// Error processing file: ActivateWhenEquation.mo
// Error: Failed to load package ActivateWhenEquation (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ActivateWhenEquation not found in scope <top>.
// Error: Error occurred while flattening model ActivateWhenEquation
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
