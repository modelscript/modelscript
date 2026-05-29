package Test
  function ext1
    output Real r;
    external "C" annotation(Library="ext1");
  end ext1;

  function ext2
    output Real r;
    external "C" annotation(Library="ext2",LibraryDirectory="modelica://Test/Resources/SpecialLib/");
  end ext2;

  function ext3
    output Real r;
    external "C" annotation(Include="#include \"ext3.c\"");
  end ext3;

  function ext4
    output Real r;
    external "C" annotation(Include="#include \"ext4.c\"",IncludeDirectory="modelica://Test/Resources/SpecialSources/");
  end ext4;
end Test;

// Result:
// Error processing file: Test.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/TestLibrary/Test.mo:1:1-21:9:writable] Error: Cannot instantiate Test due to class specialization package.
//
// Execution failed!
// endResult
