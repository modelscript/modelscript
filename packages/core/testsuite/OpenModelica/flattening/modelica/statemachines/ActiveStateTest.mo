// name: ActiveTest
// keywords: state machines features
// status: correct

model ActiveStateTest
  block AState
  output Real dummy;
  end AState;
  AState aState;
  Boolean isActive;
equation
  isActive = activeState(aState);
end ActiveStateTest;

// Result:
// Error processing file: ActiveStateTest.mo
// Error: Failed to load package ActiveTest (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ActiveTest not found in scope <top>.
// Error: Error occurred while flattening model ActiveTest
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
