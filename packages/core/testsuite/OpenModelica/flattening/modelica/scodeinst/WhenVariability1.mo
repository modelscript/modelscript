// name: WhenVariablity1
// keywords:
// status: incorrect
//

model WhenVariability1
  Real x;
equation
  when pre(x) > 1 then
  end when;
end WhenVariability1;

// Result:
// Error processing file: WhenVariability1.mo
// Error: Failed to load package WhenVariablity1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenVariablity1 not found in scope <top>.
// Error: Error occurred while flattening model WhenVariablity1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
