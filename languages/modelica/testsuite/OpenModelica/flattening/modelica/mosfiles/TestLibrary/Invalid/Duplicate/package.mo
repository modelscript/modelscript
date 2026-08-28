within Invalid;
package Duplicate
end Duplicate;

// Result:
// Error processing file: package.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
// Failed to parse file: OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/Duplicate/package.mo!
//
// Failed to parse file: OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/Duplicate/package.mo!
//
// [OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid/Duplicate/package.mo:2:1-3:14:writable] Error: Expected the package to have within ; but got within Invalid;.
// Error: Failed to load package Duplicate () using MODELICAPATH /home/omar/git/modelscript/packages/core/testsuite/OpenModelica/flattening/modelica/mosfiles/TestLibrary/Invalid.
//
// Execution failed!
// endResult
