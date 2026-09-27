import { Option, Schema } from 'effect';
import path from 'node:path';

// Source Map v3 (https://tc39.es/ecma426/). Index maps with `sections` are
// not supported and fail to decode.
const sourceMapSchema = Schema.Struct({
  version: Schema.Literal(3),
  sourceRoot: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sources: Schema.Array(Schema.NullOr(Schema.String)),
  names: Schema.optionalKey(Schema.Array(Schema.String)),
  mappings: Schema.String,
});

export type SourceMap = typeof sourceMapSchema.Type;

export const parseSourceMap = (input: string): SourceMap | null =>
  Option.getOrNull(
    Schema.decodeUnknownOption(Schema.fromJsonString(sourceMapSchema))(input),
  );

const base64 = new Map(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(
    (character, index) => [character, index],
  ),
);

function decodeSegment(segment: string): number[] | null {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (const character of segment) {
    const digit = base64.get(character);

    if (digit === undefined) {
      return null;
    }

    value += (digit & 31) * 2 ** shift;

    if ((digit & 32) === 0) {
      values.push(value % 2 === 1 ? -(value - 1) / 2 : value / 2);
      value = 0;
      shift = 0;
    } else {
      shift += 5;
    }
  }

  return shift === 0 ? values : null;
}

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
  name: string | null;
};

// Lines and columns are 1-based on both sides, as V8 stack frames print them.
// The mapping that starts at or before the column on that generated line
// wins; a position before the first mapping on its line resolves to nothing.
export function originalPosition(
  map: SourceMap,
  line: number,
  column: number,
): OriginalPosition | null {
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  let best: OriginalPosition | null = null;
  const rows = map.mappings.split(';');

  for (const [index, row] of rows.entries()) {
    let generatedColumn = 0;

    for (const segment of row.split(',')) {
      if (segment === '') {
        continue;
      }

      const fields = decodeSegment(segment);

      if (fields === null || ![1, 4, 5].includes(fields.length)) {
        return null;
      }

      const [columnDelta = 0, sourceDelta, lineDelta, columnOffset, nameDelta] =
        fields;
      generatedColumn += columnDelta;

      if (
        sourceDelta === undefined ||
        lineDelta === undefined ||
        columnOffset === undefined
      ) {
        if (index === line - 1 && generatedColumn <= column - 1) {
          best = null;
        }

        continue;
      }

      source += sourceDelta;
      sourceLine += lineDelta;
      sourceColumn += columnOffset;

      if (nameDelta !== undefined) {
        name += nameDelta;
      }

      if (index === line - 1 && generatedColumn <= column - 1) {
        const file = map.sources[source];

        best =
          file === undefined || file === null
            ? null
            : {
                source: path.posix.join(map.sourceRoot ?? '', file),
                line: sourceLine + 1,
                column: sourceColumn + 1,
                name:
                  nameDelta === undefined ? null : (map.names?.[name] ?? null),
              };
      }
    }

    if (index === line - 1) {
      return best;
    }
  }

  return null;
}

// Bundlers write sources relative to the map, such as `../../src/App.jsx`
// from dist/assets, or under a scheme such as `webpack://app/./src/App.jsx`.
// The map's own location on disk is unknown, so a source matches the
// snapshot file that is its longest path suffix.
export function snapshotPath(
  source: string,
  files: ReadonlySet<string>,
): string | null {
  const withoutScheme = source.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const parts = path.posix
    .normalize(`/${withoutScheme.replace(/\?.*$/, '')}`)
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..');

  if (parts.includes('node_modules')) {
    return null;
  }

  for (let start = 0; start < parts.length; start++) {
    const suffix = parts.slice(start).join('/');

    if (files.has(suffix)) {
      return suffix;
    }
  }

  return null;
}

export type StackFrame = {
  name: string | null;
  url: string;
  line: number;
  column: number;
};

const v8Frame =
  /^\s*at (?:(?:async |new )?([^\s(][^(]*?) \()?(\S+?):(\d+):(\d+)\)?\s*$/;
const geckoFrame = /^\s*([^@\s]*)@(\S+?):(\d+):(\d+)\s*$/;

// Frames as V8 (`at name (url:line:column)`) and Firefox or Safari
// (`name@url:line:column`) print them, with 1-based lines and columns.
export function stackFrames(text: string): StackFrame[] {
  return text.split('\n').flatMap((line) => {
    const match = v8Frame.exec(line) ?? geckoFrame.exec(line);
    const [, name, url, row, column] = match ?? [];

    if (url === undefined || row === undefined || column === undefined) {
      return [];
    }

    const lineNumber = Number(row);
    const columnNumber = Number(column);

    return lineNumber > 0 && columnNumber > 0
      ? [
          {
            name: name === undefined || name === '' ? null : name,
            url,
            line: lineNumber,
            column: columnNumber,
          },
        ]
      : [];
  });
}

const text = Schema.NonEmptyString.check(Schema.isTrimmed());

// Written by the capture while the application still runs. Scripts are
// named by their path on the application's origin, as React sources are.
export const sourceMapIndexSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  origin: text,
  scripts: Schema.Array(
    Schema.Struct({
      script: text,
      map: Schema.Union([
        Schema.Struct({
          kind: Schema.Literal('recorded'),
          path: text,
          via: Schema.Literals(['adjacent', 'sourceMappingURL', 'inline']),
        }),
        Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
      ]),
    }),
  ),
});

export type SourceMapIndex = typeof sourceMapIndexSchema.Type;

export const sourceMapIndexPath = 'source-maps.json';

// A script on the application's origin, named by its path.
export function applicationScript(url: string, origin: string): string | null {
  const parsed = URL.parse(url);

  return parsed !== null && parsed.origin === origin ? parsed.pathname : null;
}
