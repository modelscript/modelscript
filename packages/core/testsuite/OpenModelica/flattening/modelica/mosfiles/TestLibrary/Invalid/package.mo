package Invalid
end Invalid;

// Result:
// Error processing file: package.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
// Failed to parse file: OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/package.mo!
//
// Failed to parse file: OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/package.mo!
//
// [OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/package.mo:1:1-2:12:writable] Error: The same class is defined in multiple files: /home/omar/git/modelscript/packages/core/testsuite/OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/Duplicate.mo, /home/omar/git/modelscript/packages/core/testsuite/OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/Duplicate/package.mo.
// Error: Failed to load package Invalid () using MODELICAPATH /home/omar/git/modelscript/packages/core/testsuite/OpenModelica/flattening/modelica/mosfiles/TestLibrary.
//
// Execution failed!
// endResult
