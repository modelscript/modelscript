// name: RecordNonPublic
// keywords: record
// status: correct
//
// Tests the declaration and instantiation of a record
// that has non-public components
// THIS TEST SHOULD FAIL
//

record TestRecord
  protected
    Integer i;
end TestRecord;

model RecordNonPublic
  TestRecord tr;
end RecordNonPublic;

// Result:
// Error processing file: RecordNonPublic.mo
// [OpenModelica/flattening/modelica/records/RecordNonPublic.mo:12:5-12:14:writable] Error: Protected sections are not allowed in record.
// Error: Error occurred while flattening model RecordNonPublic
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
