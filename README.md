# quiet-test-lint

A CI run says "42 passed" and everyone moves on. Nobody notices that three of
those tests were `it.skip`'d six months ago, one `describe.only` is hiding an
entire suite, and half the "passing" output is actually `console.log` noise
from a debug session someone forgot to remove. The test output is telling you
what you want to hear, not what actually ran.

quiet-test-lint scans test source files for exactly that kind of problem and
reports each finding with a file, line, and column, the way a compiler error
would, so you can grep or pipe the result straight into an editor.

It has no runtime dependencies. It is not a test runner and does not execute
anything - it reads source text and pattern-matches lines.

## What it catches (so far)

- `it.only` / `describe.only` / `test.only` - silently hides every other test
  in the file or run.
- `it.skip` / `xit` / `xdescribe` - a test that quietly stopped running and
  nobody noticed the report shrink.
- `console.log` / `console.warn` / `console.error` / `console.debug` inside
  test files - output that interleaves with the test reporter and makes real
  failures harder to spot.
- Empty test bodies - `it('does the thing', () => {})` reports as a pass
  without checking anything, including a body that only contains a leftover
  comment.

## Usage

Build once:

```
npm run build
```

Lint specific files:

```
node dist/cli.js src/user.test.ts src/auth.test.ts
```

Lint a whole test directory by piping in a file list:

```
find . -name '*.test.ts' | xargs node dist/cli.js
```

Or read from stdin directly - useful when a file is already in a pipe, or
when checking a diff before it is written to disk:

```
git show HEAD:src/user.test.ts | node dist/cli.js
cat src/user.test.ts | node dist/cli.js -
```

With no arguments and no piped input, it reads stdin. Passing `-` as one of
the arguments also reads stdin for that position, so you can mix stdin with
real file paths in one call.

Example output:

```
src/user.test.ts:12:1  error  no-focused-test  focused test will silently hide every other test in this run
src/user.test.ts:30:5  warn   no-console-in-test  console output here will interleave with the test reporter output

2 finding(s), 1 error(s)
```

Exit code is `1` if any finding is an error, `0` otherwise, so it can gate CI.

## Why not just use ESLint

ESLint rules like `no-only-tests` exist, but they require ESLint's full
config and dependency chain to be installed and wired up. This is a single
small script with no dependencies at all, meant to be droppable into a repo
or run against a stray file without any setup.
