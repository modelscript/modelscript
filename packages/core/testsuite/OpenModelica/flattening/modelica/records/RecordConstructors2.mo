// status: correct

model RecordConstructors2
  record R
    constant Real default = 1.5;
    Real r = default;
  end R;
  R r = R();
end RecordConstructors2;

// Result:
// Error processing file: RecordConstructors2.mo
// Error: Failed to load package R (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class R not found in scope <top>.
// Error: Error occurred while flattening model R
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
