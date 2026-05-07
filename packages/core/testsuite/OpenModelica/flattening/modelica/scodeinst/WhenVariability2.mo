// name: WhenVariablity2
// keywords:
// status: incorrect
//

model WhenVariability2
  Real x;
algorithm
  when pre(x) > 1 then
  end when;
end WhenVariability2;

// Result:
// Error processing file: WhenVariability2.mo
// Error: Failed to load package WhenVariablity2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenVariablity2 not found in scope <top>.
// Error: Error occurred while flattening model WhenVariablity2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
