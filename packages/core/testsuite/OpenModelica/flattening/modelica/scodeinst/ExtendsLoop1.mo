// name: ExtendsLoop1
// keywords:
// status: incorrect
// cflags: -i=ExtendsLoop1.M
//

model ExtendsLoop1
  model M
    extends ExtendsLoop1;
  end M;
end ExtendsLoop1;

// Result:
// class ExtendsLoop1
// end ExtendsLoop1;
// endResult
