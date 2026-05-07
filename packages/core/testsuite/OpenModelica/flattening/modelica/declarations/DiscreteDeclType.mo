// name: DiscreteDeclType
// keywords: discrete
// status: correct
//
// Tests the discrete prefix on a regular type
//

class DiscreteDeclType
  discrete Real rDiscrete = 1.0;
end DiscreteDeclType;

// Result:
// Error processing file: DiscreteDeclType.mo
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclType.mo:9:3-9:32:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclType.mo:9:3-9:32:writable] Error: Following variable is discrete, but does not appear on the LHS of a when-statement: 'rDiscrete'.
// Error: Error occurred while flattening model DiscreteDeclType
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
