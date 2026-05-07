// name: DiscreteDeclRecord
// keywords: discrete
// status: correct
//
// Tests the discrete prefix on a record type
//

record DiscreteRecord
  Real r;
end DiscreteRecord;

class DiscreteDeclRecord
  discrete DiscreteRecord dr;
equation
  dr.r = 1.0;
end DiscreteDeclRecord;

// Result:
// Error processing file: DiscreteDeclRecord.mo
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclRecord.mo:13:3-13:29:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclRecord.mo:15:3-15:13:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclRecord.mo:9:3-9:9:writable] Error: Following variable is discrete, but does not appear on the LHS of a when-statement: 'dr.r'.
// Error: Error occurred while flattening model DiscreteDeclRecord
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
