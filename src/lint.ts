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

  return findings
}
