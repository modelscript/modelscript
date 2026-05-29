// name: IfExpression6
// keywords:
// status: correct
//

model M
  parameter Boolean b;
  Real x[if b then 2 else 3] = if b then {1, 2} else {3, 4, 5};
end M;

model IfExpression6
  M m[2](b = {true, false});
end IfExpression6;

// Result:
// Error processing file: IfExpression6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [/var/lib/jenkins2/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.7~1-g2b913cc/OMCompiler/Compiler/NFFrontEnd/NFSubscript.mo:789:11-790:53:writable] Error: Internal error NFSubscript.toDAEExp failed on unknown subscript '<m, 1>'
//
// Execution failed!
// endResult
