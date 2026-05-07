// name: StringPool
// status: correct
// teardown_command: rm -f StringPool_*
//
// Tests that the stringpool runtime returns proper strings from
// function calls

package StringPool

function weirdStrStuff
  input String str;
  output String os1;
  output String os2;
algorithm
  os1 := "os1";
  os2 := "os2";
end weirdStrStuff;

function weirdStrStuff1
  input String str;
  output String os;
protected
  String os1,os2;
algorithm
  (os1,os2) := weirdStrStuff(str);
  os := "overwritethecharpoolhere";
  os := os1+os2;
end weirdStrStuff1;

  constant String str1 = weirdStrStuff1("abc");
end StringPool;

// Result:
// Error processing file: StringPool.mo
// [OpenModelica/flattening/modelica/others/StringPool.mo:8:1-32:15:writable] Error: Cannot instantiate StringPool due to class specialization package.
// Error: Error occurred while flattening model StringPool
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
