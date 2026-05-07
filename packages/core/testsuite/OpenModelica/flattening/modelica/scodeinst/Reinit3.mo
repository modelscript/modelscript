// name: Reinit3
// keywords:
// status: correct
//

model Reinit3
  Real x;
algorithm
  when time > 1 then
    reinit(x, 2);
  end when;
end Reinit3;

// Result:
// Error processing file: Reinit3.mo
// [OpenModelica/flattening/modelica/scodeinst/Reinit3.mo:10:5-10:17:writable] Error: Operator reinit may not be used in an algorithm section (use translation flag --allowNonStandardModelica=reinitInAlgorithms to ignore).
// Error: Error occurred while flattening model Reinit3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
