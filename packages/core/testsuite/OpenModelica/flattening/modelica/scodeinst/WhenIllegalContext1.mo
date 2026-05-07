// name: WhenIllegalContext1
// keywords:
// status: incorrect
//

function f
  input Real x;
  output Real y = x;
algorithm
  when x > 1 then
    y := x * 2;
  end when;
end f;

model WhenIllegalContext1
  Real x = f(time);
end WhenIllegalContext1;

// Result:
// Error processing file: WhenIllegalContext1.mo
// [OpenModelica/flattening/modelica/scodeinst/WhenIllegalContext1.mo:10:3-12:11:writable] Error: A when-statement may not be used inside a function or a while, if, or for-clause.
// Error: Error occurred while flattening model WhenIllegalContext1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
