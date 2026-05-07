// name: DiscreteDeclConnector
// keywords: discrete
// status: correct
//
// Tests the discrete prefix on a connector type
//

connector DiscreteConnector
  Real r;
  flow Real f;
end DiscreteConnector;

class DiscreteDeclConnector
  discrete DiscreteConnector dc;
equation
  dc.r = 1.0;
end DiscreteDeclConnector;

// Result:
// Error processing file: DiscreteDeclConnector.mo
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclConnector.mo:14:3-14:32:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclConnector.mo:16:3-16:13:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclConnector.mo:10:3-10:14:writable] Error: Following variable is discrete, but does not appear on the LHS of a when-statement: 'dc.f'.
// [OpenModelica/flattening/modelica/declarations/DiscreteDeclConnector.mo:9:3-9:9:writable] Error: Following variable is discrete, but does not appear on the LHS of a when-statement: 'dc.r'.
// Error: Error occurred while flattening model DiscreteDeclConnector
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
