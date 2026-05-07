// name: WhenIllegalContext2
// keywords:
// status: incorrect
//

model WhenIllegalContext2
  Real x;
algorithm
  if x > 1 then
    when time > 1 then
      x := 1.0;
    end when;
  end if;
end WhenIllegalContext2;

// Result:
// Error processing file: WhenIllegalContext2.mo
// [OpenModelica/flattening/modelica/scodeinst/WhenIllegalContext2.mo:10:5-12:13:writable] Error: A when-statement may not be used inside a function or a while, if, or for-clause.
// Error: Error occurred while flattening model WhenIllegalContext2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
