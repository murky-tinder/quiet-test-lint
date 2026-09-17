import { readFileSync } from 'node:fs'
import { lintText, type Finding } from './lint'

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

function printFinding(f: Finding): void {
  const label = f.severity === 'error' ? 'error' : 'warn '
  console.log(`${f.file}:${f.line}:${f.column}  ${label}  ${f.rule}  ${f.message}`)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const jsonOutput = args.includes('--json')
  const targets = args.filter((a) => a !== '--json')
  const paths = targets.length > 0 ? targets : ['-']

  let findings: Finding[] = []

  for (const target of paths) {
    const source =
      target === '-' ? await readStdin() : readFileSync(target, 'utf8')
    const label = target === '-' ? '<stdin>' : target
    findings = findings.concat(lintText(source, label))
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warningCount = findings.length - errorCount

  if (jsonOutput) {
    // Machine-readable path for CI: exact shape, no trailing summary line
    // mixed into the same stream as the printed one.
    console.log(JSON.stringify({ findings, errorCount, warningCount }))
  } else {
    for (const finding of findings) {
      printFinding(finding)
    }
    if (findings.length > 0) {
      console.log(`\n${findings.length} finding(s), ${errorCount} error(s)`)
    }
  }

  return errorCount > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  })
