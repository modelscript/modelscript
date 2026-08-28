/* Sadly, Modelica does not allow this:

function 'オーペンモーデリッカー・ロックス'
  input Real 'キャン・ザー・デバガー・シー・ミー';
  output Real 'イェッス・イット・キャン';
algorithm
  'イェッス・イット・キャン' := sin('キャン・ザー・デバガー・シー・ミー');
end 'オーペンモーデリッカー・ロックス';

*/

function '\"\''
  input Real '#';
  output Real '23';
algorithm
  '23' := sin('#');
end '\"\'';


// Result:
// Error processing file: QuotedFunction.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/QuotedFunction.mo:12:1-17:11:writable] Error: Cannot instantiate '\"\'' due to class specialization function.
//
// Execution failed!
// endResult
