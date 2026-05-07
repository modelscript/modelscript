// name: TypeClass1
// keywords: type
// status: correct
//
// Tests type declaration from a legal class
//

class LegalClass
  extends Integer;
end LegalClass;

type LegalType = LegalClass;

model TypeClass1
  LegalType lt;
equation
  lt = 1;
end TypeClass1;

// Result:
// Error processing file: TypeClass1.mo
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFTyping.mo:497:9-497:127:writable] Error: Internal error NFTyping.typeComponent got noninstantiated component quantity
// Error: Error occurred while flattening model TypeClass1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
