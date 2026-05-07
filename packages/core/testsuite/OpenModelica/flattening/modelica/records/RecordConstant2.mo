// name:     RecordConstant2
// keywords: record, constant
// status:   correct
//
// Checks that it's possible to look up components through nestled record
// constants.
//

package P
  record R1
    Real r;
  end R1;

  record R2
    R1 r1;
  end R2;

  constant R2 cr(r1 = R1(r = 2.0));
end P;

model RecordConstant1
  constant Real r2 = P.cr.r1.r;
end RecordConstant1;

// Result:
// Error processing file: RecordConstant2.mo
// Error: Failed to load package RecordConstant2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RecordConstant2 not found in scope <top>.
// Error: Error occurred while flattening model RecordConstant2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
