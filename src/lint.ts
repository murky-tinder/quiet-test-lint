export type Severity = 'error' | 'warning'

export interface Finding {
  file: string
  line: number
  column: number
  rule: string
  severity: Severity
  message: string
}

interface Rule {
  name: string
  severity: Severity
  pattern: RegExp
  message: string
}

// Each rule targets something that makes `it passed` / `it failed` output
// lie about what actually ran, rather than style preferences.
const RULES: Rule[] = [
  {
    name: 'no-focused-test',
    severity: 'error',
    pattern: /\b(it|test|describe)\.only\s*\(/,
    message: 'focused test will silently hide every other test in this run',
  },
  {
    name: 'no-disabled-test',
    severity: 'warning',
    pattern: /\b(it|test|describe)\.skip\s*\(|\bx(it|describe)\s*\(/,
    message: 'disabled test disappears from output instead of showing as skipped',
  },
  {
    name: 'no-console-in-test',
    severity: 'warning',
    pattern: /\bconsole\.(log|warn|error|debug)\s*\(/,
    message: 'console output here will interleave with the test reporter output',
  },
]

// Two rules are implemented as scanners rather than line patterns, so the
// list of valid names for config validation can't be derived from RULES alone.
export const RULE_NAMES: string[] = [
  ...RULES.map((r) => r.name),
  'no-empty-test',
  'no-duplicate-test-name',
]

export function lintText(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  const lines = source.split(/\r\n|\r|\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of RULES) {
      const match = rule.pattern.exec(line)
      if (match) {
        findings.push({
          file,
          line: i + 1,
          column: match.index + 1,
          rule: rule.name,
          severity: rule.severity,
          message: rule.message,
        })
      }
    }
  }

  findings.push(...findEmptyTestBodies(source, file))
  findings.push(...findDuplicateTestNames(source, file))

  findings.sort((a, b) => a.line - b.line || a.column - b.column)

  return findings
}

// Matches the head of an `it`/`test` call up to and including the opening
// brace of its callback body, so the matching close can be located by
// counting braces from there. Deliberately excludes `describe` - an empty
// describe block is just an empty suite, not a test that silently "passed".
const TEST_CALL_HEAD =
  /\b(?:it|test)(?:\.(?:only|skip))?\s*\(\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1\s*,\s*(?:async\s+)?(?:function\b[^({]*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g

// A test body can be empty two ways that matter: no statements at all, or
// only a comment (someone left a `// TODO` and never wrote the assertion).
// Both report as a pass with nothing actually checked, so both count.
function stripComments(text: string): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    result += text[i]
    i++
  }
  return result
}

// Scans forward from an opening brace to its matching close, skipping over
// string/template literals and comments so a `}` inside one doesn't throw
// off the depth count.
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 1
  let i = openIndex + 1
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < source.length && source[i] !== quote) {
        i += source[i] === '\\' ? 2 : 1
      }
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  return depth === 0 ? i - 1 : -1
}

function locate(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  return { line, column: index - lastNewline }
}

function findEmptyTestBodies(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  const pattern = new RegExp(TEST_CALL_HEAD)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source))) {
    const openBrace = match.index + match[0].length - 1
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace === -1) continue

    const body = stripComments(source.slice(openBrace + 1, closeBrace)).trim()
    if (body.length === 0) {
      const { line, column } = locate(source, match.index)
      findings.push({
        file,
        line,
        column,
        rule: 'no-empty-test',
        severity: 'error',
        message: 'empty test body reports as passing without checking anything',
      })
    }

    pattern.lastIndex = closeBrace + 1
  }

  return findings
}

// Same head shape as TEST_CALL_HEAD but also matches `describe` and captures
// the call kind plus the raw (still-escaped) name text, since duplicate
// detection needs to compare names and duplicate scoping needs to know
// which calls open a new describe block.
const NAMED_CALL_HEAD_SOURCE =
  '\\b(describe|it|test)(?:\\.(?:only|skip))?\\s*\\(\\s*([\'"`])((?:\\\\.|(?!\\2)[\\s\\S])*?)\\2\\s*,\\s*(?:async\\s+)?(?:function\\b[^({]*\\([^)]*\\)|\\([^)]*\\)\\s*=>)\\s*\\{'

// Two `it`/`test` calls with the same name in the same describe block report
// as two separate results with an identical label, so a failure in one is
// indistinguishable from a failure in the other when reading the output.
// Names are only compared within their own scope - the same name reused
// across sibling or unrelated describe blocks is normal and not flagged.
function findDuplicateTestNames(source: string, file: string): Finding[] {
  const findings: Finding[] = []
  scanForDuplicateNames(source, 0, source.length, new Set(), file, findings)
  return findings
}

function scanForDuplicateNames(
  source: string,
  from: number,
  to: number,
  seen: Set<string>,
  file: string,
  findings: Finding[],
): void {
  const pattern = new RegExp(NAMED_CALL_HEAD_SOURCE, 'g')
  pattern.lastIndex = from
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source))) {
    if (match.index >= to) break

    const kind = match[1]
    const name = match[3]
    const openBrace = match.index + match[0].length - 1
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace === -1 || closeBrace >= to) {
      pattern.lastIndex = match.index + match[0].length
      continue
    }

    if (kind === 'describe') {
      scanForDuplicateNames(source, openBrace + 1, closeBrace, new Set(), file, findings)
    } else if (seen.has(name)) {
      const { line, column } = locate(source, match.index)
      findings.push({
        file,
        line,
        column,
        rule: 'no-duplicate-test-name',
        severity: 'warning',
        message: `duplicate test name "${name}" already used in this describe block`,
      })
    } else {
      seen.add(name)
    }

    pattern.lastIndex = closeBrace + 1
  }
}
