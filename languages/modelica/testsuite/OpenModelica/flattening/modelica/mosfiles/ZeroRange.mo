package ZeroRange

function testRangeLoop "Returns the number of iterations a loop over a range this length has"
  input Integer start;
  input Integer step;
  input Integer stop;
  output Integer o;
algorithm
  o := 0;
  for i in start:step:stop loop
    o := o + 1;
  end for;
end testRangeLoop;

end ZeroRange;

// Result:
// Error processing file: ZeroRange.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/ZeroRange.mo:1:1-15:14:writable] Error: Cannot instantiate ZeroRange due to class specialization package.
//
// Execution failed!
// endResult
