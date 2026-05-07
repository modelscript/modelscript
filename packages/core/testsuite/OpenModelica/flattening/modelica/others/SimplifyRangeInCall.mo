// name:     SimplifyRangeInCall
// keywords: simplify call range
// status:   correct
//
// Checks that ranges in calls are simplified.
//

class SimplifyRangeInClass
  Real r[2] = sin(1:2);
end SimplifyRangeInClass;

// Result:
// Error processing file: SimplifyRangeInCall.mo
// Error: Failed to load package SimplifyRangeInCall (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SimplifyRangeInCall not found in scope <top>.
// Error: Error occurred while flattening model SimplifyRangeInCall
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
