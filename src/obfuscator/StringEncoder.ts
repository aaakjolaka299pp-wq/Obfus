import type {
  Chunk,
  Statement,
  LastStatement,
  Expression,
  CallExpression,
  TableConstructor,
  TableField,
} from "../ast/types.js";
import type { SourceLocation } from "../tokens.js";

function makeLoc(start: SourceLocation["start"], end: SourceLocation["end"]): SourceLocation {
  return { start, end };
}

function encodeString(str: string, key: number, step: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const rollingKey = (key + i * step) & 0xff;
    result.push(str.charCodeAt(i) ^ rollingKey);
  }
  return result;
}

function makeDecodeCall(
  bytes: number[],
  key: number,
  step: number,
  loc: SourceLocation,
  decoderName: string
): CallExpression {
  const tableFields: TableField[] = bytes.map((b) => ({
    kind: "value" as const,
    value: {
      type: "NumberLiteral",
      value: String(b),
      loc,
    },
  }));

  const table: TableConstructor = {
    type: "TableConstructor",
    fields: tableFields,
    loc,
  };

  return {
    type: "CallExpression",
    callee: {
      type: "Identifier",
      name: decoderName,
      loc,
    },
    args: [
      table,
      { type: "NumberLiteral", value: String(key), loc },
      { type: "NumberLiteral", value: String(step), loc },
    ],
    loc,
  };
}

function makeDecoderStatements(loc: SourceLocation, decoderName: string): Statement[] {
  const cacheName = `_c_${Math.random().toString(36).substring(2, 6)}`;

  const cacheStmt: Statement = {
    type: "LocalStatement",
    vars: [{ name: cacheName, type: undefined }],
    values: [{ type: "TableConstructor", fields: [], loc }],
    loc,
  };

  const ifCacheStmt: Statement = {
    type: "IfStatement",
    condition: {
      type: "IndexExpression",
      object: { type: "Identifier", name: cacheName, loc },
      index: { type: "Identifier", name: "t", loc },
      loc,
    },
    thenBody: [
      {
        type: "ReturnStatement",
        values: [
          {
            type: "IndexExpression",
            object: { type: "Identifier", name: cacheName, loc },
            index: { type: "Identifier", name: "t", loc },
            loc,
          },
        ],
        loc,
      },
    ],
    elseifClauses: [],
    loc,
  };

  const sTableStmt: Statement = {
    type: "LocalStatement",
    vars: [{ name: "s", type: undefined }],
    values: [{ type: "TableConstructor", fields: [], loc }],
    loc,
  };

  // Computes: bit32.band(k + (i-1) * st, 0xFF) as the effective per-index key
  const rollingKeyExpr: Expression = {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: "bit32", loc },
      property: "band",
      loc,
    },
    args: [
      {
        type: "BinaryExpression",
        operator: "+",
        left: { type: "Identifier", name: "k", loc },
        right: {
          type: "BinaryExpression",
          operator: "*",
          left: {
            type: "BinaryExpression",
            operator: "-",
            left: { type: "Identifier", name: "i", loc },
            right: { type: "NumberLiteral", value: "1", loc },
            loc,
          },
          right: { type: "Identifier", name: "st", loc },
          loc,
        },
        loc,
      },
      { type: "NumberLiteral", value: "255", loc },
    ],
    loc,
  };

  const forLoopStmt: Statement = {
    type: "ForNumericStatement",
    var: { type: "Identifier", name: "i", loc },
    start: { type: "NumberLiteral", value: "1", loc },
    end: {
      type: "UnaryExpression",
      operator: "#",
      argument: { type: "Identifier", name: "t", loc },
      loc,
    },
    body: [
      {
        type: "AssignmentStatement",
        vars: [
          {
            type: "IndexExpression",
            object: { type: "Identifier", name: "s", loc },
            index: { type: "Identifier", name: "i", loc },
            loc,
          },
        ],
        values: [
          {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "string", loc },
              property: "char",
              loc,
            },
            args: [
              {
                type: "CallExpression",
                callee: {
                  type: "MemberExpression",
                  object: { type: "Identifier", name: "bit32", loc },
                  property: "bxor",
                  loc,
                },
                args: [
                  {
                    type: "IndexExpression",
                    object: { type: "Identifier", name: "t", loc },
                    index: { type: "Identifier", name: "i", loc },
                    loc,
                  },
                  rollingKeyExpr,
                ],
                loc,
              },
            ],
            loc,
          },
        ],
        loc,
      },
    ],
    loc,
  };

  const concatStmt: Statement = {
    type: "LocalStatement",
    vars: [{ name: "res", type: undefined }],
    values: [
      {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "table", loc },
          property: "concat",
          loc,
        },
        args: [{ type: "Identifier", name: "s", loc }],
        loc,
      },
    ],
    loc,
  };

  const cacheAssignStmt: Statement = {
    type: "AssignmentStatement",
    vars: [
      {
        type: "IndexExpression",
        object: { type: "Identifier", name: cacheName, loc },
        index: { type: "Identifier", name: "t", loc },
        loc,
      },
    ],
    values: [{ type: "Identifier", name: "res", loc }],
    loc,
  };

  const returnStmt: LastStatement = {
    type: "ReturnStatement",
    values: [{ type: "Identifier", name: "res", loc }],
    loc,
  };

  const decoderFunc: Statement = {
    type: "LocalStatement",
    vars: [{ name: decoderName, type: undefined }],
    values: [
      {
        type: "FunctionExpression",
        params: [
          { type: "Param", name: "t", variadic: false, loc },
          { type: "Param", name: "k", variadic: false, loc },
          { type: "Param", name: "st", variadic: false, loc },
        ],
        body: [
          ifCacheStmt,
          sTableStmt,
          forLoopStmt,
          concatStmt,
          cacheAssignStmt,
          returnStmt,
        ],
        loc,
      },
    ],
    loc,
  };

  return [cacheStmt, decoderFunc];
}

function randByte(): number {
  return 1 + Math.floor(Math.random() * 254);
}

function transformExpression(exp: Expression, decoderName: string): Expression {
  if (exp.type === "StringLiteral") {
    if (exp.value === "") return exp;
    const key = randByte();
    const step = randByte();
    const bytes = encodeString(exp.value, key, step);
    return makeDecodeCall(bytes, key, step, exp.loc, decoderName) as Expression;
  }
  if (exp.type === "BinaryExpression") {
    return {
      ...exp,
      left: transformExpression(exp.left, decoderName),
      right: transformExpression(exp.right, decoderName),
    };
  }
  if (exp.type === "UnaryExpression") {
    return { ...exp, argument: transformExpression(exp.argument, decoderName) };
  }
  if (exp.type === "CallExpression") {
    return {
      ...exp,
      callee: transformExpression(exp.callee, decoderName),
      args: exp.args.map((a) => transformExpression(a, decoderName)),
    };
  }
  if (exp.type === "MethodCallExpression") {
    return {
      ...exp,
      object: transformExpression(exp.object, decoderName),
      args: exp.args.map((a) => transformExpression(a, decoderName)),
    };
  }
  if (exp.type === "IndexExpression") {
    return {
      ...exp,
      object: transformExpression(exp.object, decoderName),
      index: transformExpression(exp.index, decoderName),
    };
  }
  if (exp.type === "MemberExpression") {
    return { ...exp, object: transformExpression(exp.object, decoderName) };
  }
  if (exp.type === "TableConstructor") {
    return {
      ...exp,
      fields: exp.fields.map((f) => {
        if (f.kind === "index")
          return { ...f, index: transformExpression(f.index, decoderName), value: transformExpression(f.value, decoderName) };
        if (f.kind === "named")
          return { ...f, value: transformExpression(f.value, decoderName) };
        return { ...f, value: transformExpression(f.value, decoderName) };
      }),
    };
  }
  if (exp.type === "FunctionExpression") {
    return {
      ...exp,
      body: exp.body.map((s) => transformStatement(s, decoderName)),
    };
  }
  if (exp.type === "ParenExpression") {
    return { ...exp, expression: transformExpression(exp.expression, decoderName) };
  }
  if (exp.type === "TypeAssertion") {
    return { ...exp, expression: transformExpression(exp.expression, decoderName) };
  }
  if (exp.type === "IfElseExpression") {
    return {
      ...exp,
      condition: transformExpression(exp.condition, decoderName),
      thenExp: transformExpression(exp.thenExp, decoderName),
      elseifClauses: exp.elseifClauses?.map((c) => ({
        ...c,
        condition: transformExpression(c.condition, decoderName),
        value: transformExpression(c.value, decoderName),
      })),
      elseExp: transformExpression(exp.elseExp, decoderName),
    };
  }
  if (exp.type === "StringInterpolation") {
    return {
      ...exp,
      parts: exp.parts.map((p) =>
        typeof p === "string" ? p : transformExpression(p, decoderName)
      ),
    };
  }
  return exp;
}

function transformStatement(stmt: Statement | LastStatement, decoderName: string): Statement | LastStatement {
  switch (stmt.type) {
    case "LocalStatement":
      return {
        ...stmt,
        values: stmt.values?.map((e) => transformExpression(e, decoderName)),
      };
    case "AssignmentStatement":
      return {
        ...stmt,
        vars: stmt.vars.map((v) => {
          if (v.type === "Identifier") return v;
          if (v.type === "IndexExpression")
            return { ...v, object: transformExpression(v.object, decoderName), index: transformExpression(v.index, decoderName) };
          return { ...v, object: transformExpression(v.object, decoderName) };
        }),
        values: stmt.values.map((e) => transformExpression(e, decoderName)),
      };
    case "CompoundAssignmentStatement":
      return {
        ...stmt,
        var: stmt.var.type === "Identifier" ? stmt.var : {
          ...stmt.var,
          object: transformExpression(stmt.var.object, decoderName),
          ...(stmt.var.type === "IndexExpression" && { index: transformExpression(stmt.var.index, decoderName) }),
        },
        value: transformExpression(stmt.value, decoderName),
      };
    case "FunctionCallStatement":
      return { ...stmt, call: transformExpression(stmt.call, decoderName) as CallExpression };
    case "ReturnStatement":
      return { ...stmt, values: stmt.values?.map((e) => transformExpression(e, decoderName)) };
    case "IfStatement":
      return {
        ...stmt,
        condition: transformExpression(stmt.condition, decoderName),
        thenBody: stmt.thenBody.map((s) => transformStatement(s, decoderName)),
        elseifClauses: stmt.elseifClauses?.map((c) => ({
          ...c,
          condition: transformExpression(c.condition, decoderName),
          body: c.body.map((s) => transformStatement(s, decoderName)),
        })),
        elseBody: stmt.elseBody?.map((s) => transformStatement(s, decoderName)),
      };
    case "ForNumericStatement":
      return {
        ...stmt,
        start: transformExpression(stmt.start, decoderName),
        end: transformExpression(stmt.end, decoderName),
        step: stmt.step ? transformExpression(stmt.step, decoderName) : undefined,
        body: stmt.body.map((s) => transformStatement(s, decoderName)),
      };
    case "ForInStatement":
      return {
        ...stmt,
        iter: stmt.iter.map((e) => transformExpression(e, decoderName)),
        body: stmt.body.map((s) => transformStatement(s, decoderName)),
      };
    case "LocalFunctionStatement":
    case "FunctionStatement":
      return {
        ...stmt,
        params: stmt.params,
        body: stmt.body.map((s) => transformStatement(s, decoderName)),
      };
    case "DoStatement":
    case "WhileStatement":
    case "RepeatStatement":
      return {
        ...stmt,
        ...(stmt.type === "WhileStatement" && { condition: transformExpression(stmt.condition, decoderName) }),
        ...(stmt.type === "RepeatStatement" && { condition: transformExpression(stmt.condition, decoderName) }),
        body: stmt.body.map((s) => transformStatement(s, decoderName)),
      };
    default:
      return stmt;
  }
}

export interface StringEncoderOptions {
  enabled?: boolean;
}

export function encodeStrings(ast: Chunk, options: StringEncoderOptions = {}): Chunk {
  const enabled = options.enabled !== false;

  if (!enabled) return ast;

  const decoderName = `_p20d_${Math.random().toString(36).substring(2, 8)}`;
  const loc = ast.body[0]?.loc ?? { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
  const decoders = makeDecoderStatements(loc, decoderName);

  const transformedBody = ast.body.map((s) => transformStatement(s, decoderName));

  return {
    ...ast,
    body: [...decoders, ...transformedBody],
  };
}
