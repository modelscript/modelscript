export enum ModelicaBinaryOperator {
  LOGICAL_OR = "or",
  LOGICAL_AND = "and",
  LESS_THAN = "<",
  LESS_THAN_OR_EQUAL = "<=",
  GREATER_THAN = ">",
  GREATER_THAN_OR_EQUAL = ">=",
  EQUALITY = "==",
  INEQUALITY = "<>",
  ADDITION = "+",
  SUBTRACTION = "-",
  ELEMENTWISE_ADDITION = ".+",
  ELEMENTWISE_SUBTRACTION = ".-",
  MULTIPLICATION = "*",
  DIVISION = "/",
  ELEMENTWISE_MULTIPLICATION = ".*",
  ELEMENTWISE_DIVISION = "./",
  EXPONENTIATION = "^",
  ELEMENTWISE_EXPONENTIATION = ".^",
}

export enum ModelicaCausality {
  INPUT = "input",
  OUTPUT = "output",
}

export enum ModelicaClassKind {
  BLOCK = "block",
  CLASS = "class",
  CONNECTOR = "connector",
  EXPANDABLE_CONNECTOR = "expandable connector",
  FUNCTION = "function",
  MODEL = "model",
  OPERATOR = "operator",
  OPTIMIZATION = "optimization",
  OPERATOR_FUNCTION = "operator function",
  OPERATOR_RECORD = "operator record",
  PACKAGE = "package",
  RECORD = "record",
  TYPE = "type",
}

export enum ModelicaFlow {
  FLOW = "flow",
  STREAM = "stream",
}

export enum ModelicaPurity {
  PURE = "pure",
  IMPURE = "impure",
}

export enum ModelicaUnaryOperator {
  ELEMENTWISE_UNARY_MINUS = ".-",
  ELEMENTWISE_UNARY_PLUS = ".+",
  LOGICAL_NEGATION = "not",
  UNARY_MINUS = "-",
  UNARY_PLUS = "+",
}

export enum ModelicaVariability {
  CONSTANT = "constant",
  DISCRETE = "discrete",
  PARAMETER = "parameter",
}

export enum ModelicaVisibility {
  PUBLIC = "public",
  PROTECTED = "protected",
}
