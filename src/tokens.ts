export interface SourceLocation {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

export interface BaseToken {
  type: string;
  loc: SourceLocation;
}

export interface KeywordToken extends BaseToken {
  type: "Keyword";
  value: string;
}

export interface IdentifierToken extends BaseToken {
  type: "Identifier";
  value: string;
}

export interface NumberToken extends BaseToken {
  type: "Number";
  value: string;
  raw: string;
}

export interface StringToken extends BaseToken {
  type: "String";
  value: string;
  raw: string;
}

export interface InterpPartToken extends BaseToken {
  type: "InterpPart";
  value: string;
}

export interface PunctuatorToken extends BaseToken {
  type: "Punctuator";
  value: string;
}

export interface EOFToken extends BaseToken {
  type: "EOF";
}

export type Token =
  | KeywordToken
  | IdentifierToken
  | NumberToken
  | StringToken
  | InterpPartToken
  | PunctuatorToken
  | EOFToken;

export const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "export", "false",
  "for", "function", "if", "in", "local", "nil", "not", "or",
  "repeat", "return", "then", "true", "until", "while",
]);

export const SOFT_KEYWORDS = new Set(["type"]);

export const TYPE_KEYWORDS = new Set(["read", "write", "typeof"]);

export const MULTI_CHAR_OPERATORS = [
  "//=", "..=", "...", "//", "..", "->", "::",
  "<=", ">=", "==", "~=", "+=", "-=", "*=", "/=", "%=", "^=",
];

export const SINGLE_CHAR_OPERATORS = "+-*/%^<>=.,;:()[]{}|&?@#";
