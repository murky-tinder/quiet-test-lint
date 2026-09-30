import { readFileSync } from 'node:fs'
import { applyConfig, loadConfig } from './config'
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
  let jsonOutput = false
  let configPath: string | undefined
  const targets: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      jsonOutput = true
    } else if (arg === '--config') {
      configPath = args[++i]
      if (configPath === undefined) {
        throw new Error('--config needs a file path')
      }
    } else {
      targets.push(arg)
    }
  }

  const config = loadConfig(configPath, process.cwd())
  const paths = targets.length > 0 ? targets : ['-']

  let findings: Finding[] = []

  for (const target of paths) {
    const source =
      target === '-' ? await readStdin() : readFileSync(target, 'utf8')
    const label = target === '-' ? '<stdin>' : target
    findings = findings.concat(applyConfig(lintText(source, label), config))
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
