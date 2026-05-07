// name:     Bug2784.mo [BUG: #2784]
// keywords: redeclare modifier handling
// status:   correct
//
// check that modifiers on redeclare are not lost
//

class C1
  replaceable parameter Real r=3.14;
end C1;

model C2
  replaceable parameter C1 x1(redeclare replaceable Real r=3);
end C2;

// Result:
// Error processing file: Bug2784.mo
// [OpenModelica/flattening/modelica/redeclare/DuplicateRedeclares2.mo:13:3-14:48:writable] Error: Base class N not found in scope DuplicateRedeclares2.
// Error: Error occurred while flattening model Bug2784.mo [BUG: #2784]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
