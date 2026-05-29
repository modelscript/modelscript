package LookupBuiltin

function identity
  input String str;
  output String o = str;
algorithm
end identity;

function id
  input String str;
  output String o = identity(str);
algorithm
end id;

end LookupBuiltin;

// Result:
// Error processing file: LookupBuiltin.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/LookupBuiltin.mo:1:1-15:18:writable] Error: Cannot instantiate LookupBuiltin due to class specialization package.
//
// Execution failed!
// endResult
