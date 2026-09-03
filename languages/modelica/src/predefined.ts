export const PREDEFINED_ATTRIBUTES: Record<string, Record<string, string>> = {
  Real: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    unit: "The unit of the variable.",
    displayUnit: "The display unit of the variable.",
    min: "The minimum value of the variable.",
    max: "The maximum value of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
    nominal: "The nominal value of the variable.",
    unbounded: "Whether the variable is unbounded.",
    stateSelect: "The state selection of the variable.",
  },
  Integer: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    min: "The minimum value of the variable.",
    max: "The maximum value of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  Boolean: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  String: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  Expression: {
    value: "The unevaluated AST expression of the variable.",
  },
};

export const PREDEFINED_ATTRIBUTE_TYPES: Record<string, Record<string, string>> = {
  Real: {
    value: "Real",
    quantity: "String",
    unit: "String",
    displayUnit: "String",
    min: "Real",
    max: "Real",
    start: "Real",
    fixed: "Boolean",
    nominal: "Real",
    unbounded: "Boolean",
    stateSelect: "StateSelect",
  },
  Integer: {
    value: "Integer",
    quantity: "String",
    min: "Integer",
    max: "Integer",
    start: "Integer",
    fixed: "Boolean",
  },
  Boolean: {
    value: "Boolean",
    quantity: "String",
    start: "Boolean",
    fixed: "Boolean",
  },
  String: {
    value: "String",
    quantity: "String",
    start: "String",
    fixed: "Boolean",
  },
  Expression: {
    value: "Expression",
  },
};

export const ENUMERATION_ATTRIBUTE_TYPES: Record<string, string> = {
  value: "enumeration",
  quantity: "String",
  min: "enumeration",
  max: "enumeration",
  start: "enumeration",
  fixed: "Boolean",
};
