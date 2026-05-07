// name: Constant13
// status: correct
// #2155 - this pattern was used in the Buildings library

model Constant13
  model DataRecord
    Real R;
    constant Real cp;
    Real cv = cp - R;
  end DataRecord;

  constant DataRecord r;
end Constant13;

// Result:
// Error processing file: Constant13.mo
// [OpenModelica/flattening/modelica/declarations/Constant13.mo:7:5-7:11:writable] Error: Constant 'r.R' has no value.
// Error: Error occurred while flattening model Constant13
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
