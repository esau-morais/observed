import { Schema } from 'effect';

const typeNames = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
] as const;

type TypeName = (typeof typeNames)[number];

export type JsonSchema = {
  readonly $schema?: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: TypeName | readonly TypeName[];
  readonly properties?: { readonly [key: string]: JsonSchema };
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly enum?: readonly Schema.Json[];
  readonly const?: Schema.Json;
  readonly anyOf?: readonly JsonSchema[];
};

const typeName = Schema.Literals(typeNames);

// The subset Observed validates. Any other keyword is rejected when the
// project loads, so an unsupported constraint never passes unchecked.
export const jsonSchema: Schema.Codec<JsonSchema> = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(
    Schema.Union([typeName, Schema.NonEmptyArray(typeName)]),
  ),
  properties: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<JsonSchema> => jsonSchema),
    ),
  ),
  required: Schema.optionalKey(
    Schema.Array(Schema.String).check(Schema.isUnique()),
  ),
  additionalProperties: Schema.optionalKey(Schema.Boolean),
  items: Schema.optionalKey(
    Schema.suspend((): Schema.Codec<JsonSchema> => jsonSchema),
  ),
  enum: Schema.optionalKey(Schema.NonEmptyArray(Schema.Json)),
  const: Schema.optionalKey(Schema.Json),
  anyOf: Schema.optionalKey(
    Schema.NonEmptyArray(
      Schema.suspend((): Schema.Codec<JsonSchema> => jsonSchema),
    ),
  ),
});

export function jsonType(value: Schema.Json): Exclude<TypeName, 'integer'> {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  return typeof value === 'boolean' ? 'boolean' : 'object';
}

// Object key order does not matter. Kept free of node:util because the
// viewer bundles this module.
export function jsonEqual(left: Schema.Json, right: Schema.Json): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const before: readonly Schema.Json[] = Array.isArray(left) ? left : [];
    const after: readonly Schema.Json[] = Array.isArray(right) ? right : [];

    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      before.length === after.length &&
      before.every((item, index) => {
        const other = after[index];

        return other !== undefined && jsonEqual(item, other);
      })
    );
  }

  if (isJsonObject(left) && isJsonObject(right)) {
    const keys = Object.keys(left);

    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => {
        const before = left[key];
        const after = right[key];

        return (
          before !== undefined &&
          after !== undefined &&
          Object.hasOwn(right, key) &&
          jsonEqual(before, after)
        );
      })
    );
  }

  return left === right;
}

function matchesType(value: Schema.Json, type: TypeName): boolean {
  return type === 'integer'
    ? typeof value === 'number' && Number.isInteger(value)
    : jsonType(value) === type;
}

export function isJsonObject(
  value: Schema.Json,
): value is { readonly [key: string]: Schema.Json } {
  return jsonType(value) === 'object';
}

// JSON Pointer (RFC 6901) segment escaping.
function child(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

// Returns every violation, each with the JSON Pointer of the value.
export function validateJson(
  schema: JsonSchema,
  value: Schema.Json,
  pointer = '',
): string[] {
  const at = pointer === '' ? 'the response body' : pointer;

  if (schema.type !== undefined) {
    const types: readonly TypeName[] =
      typeof schema.type === 'string' ? [schema.type] : schema.type;

    if (!types.some((type) => matchesType(value, type))) {
      return [`${at} is ${jsonType(value)}, expected ${types.join(' or ')}`];
    }
  }

  const issues: string[] = [];

  if (schema.const !== undefined && !jsonEqual(value, schema.const)) {
    issues.push(`${at} is not ${JSON.stringify(schema.const)}`);
  }

  if (
    schema.enum !== undefined &&
    !schema.enum.some((option) => jsonEqual(value, option))
  ) {
    issues.push(`${at} is not one of the listed values`);
  }

  if (
    schema.anyOf !== undefined &&
    !schema.anyOf.some(
      (option) => validateJson(option, value, pointer).length === 0,
    )
  ) {
    issues.push(`${at} matches none of the anyOf alternatives`);
  }

  if (isJsonObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        issues.push(`${child(pointer, key)} is missing`);
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const property = schema.properties?.[key];

      if (property !== undefined) {
        issues.push(...validateJson(property, entry, child(pointer, key)));
      } else if (schema.additionalProperties === false) {
        issues.push(`${child(pointer, key)} is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;

    value.forEach((entry: Schema.Json, index) => {
      issues.push(...validateJson(items, entry, child(pointer, index)));
    });
  }

  return issues;
}

// Resolves a JSON Pointer; undefined when any segment is missing.
export function resolvePointer(
  value: Schema.Json,
  pointer: string,
): Schema.Json | undefined {
  if (pointer === '') {
    return value;
  }

  let current: Schema.Json | undefined = value;

  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');

    if (current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const items: readonly Schema.Json[] = current;

      current = /^(?:0|[1-9]\d*)$/.test(key) ? items[Number(key)] : undefined;
    } else if (isJsonObject(current) && Object.hasOwn(current, key)) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

export const jsonPointerSchema = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value === '' || (value.startsWith('/') && !/~[^01]|~$/.test(value)),
    { message: 'Expected a JSON Pointer such as /stations/0/name' },
  ),
);
