export { lex, Lexer, type LexResult } from "./lexer/Lexer.js";
export { parse, parseWithErrors, Parser, type ParseResult } from "./parser/Parser.js";
export { obfuscate, printChunk, printExpression, type ObfuscatorOptions } from "./obfuscator/index.js";
export type { Token, SourceLocation } from "./tokens.js";
export type { Chunk, Statement, Expression } from "./ast/types.js";
export { compile } from "./vm/Compiler.js";
export type { BytecodeChunk, Constant } from "./vm/bytecode.js";
export { generateVM, type VMGenOptions, type VMGenLevel } from "./vm/vm-gen.js";
export { validate, type ValidationResult, type ValidationError } from "./compiler/LuauCompiler.js";

