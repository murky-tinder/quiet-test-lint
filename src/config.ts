import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RULE_NAMES, type Finding } from './lint'

export const DEFAULT_CONFIG_NAME = '.quiet-test-lint.json'

export interface Config {
  disabled: Set<string>
}

export function parseConfig(text: string, origin: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${origin}: invalid JSON (${err instanceof Error ? err.message : err})`)
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${origin}: expected a JSON object`)
  }

  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (key !== 'disable') {
      throw new Error(`${origin}: unknown option "${key}"`)
    }
  }

  const disable = obj.disable ?? []
  if (!Array.isArray(disable) || disable.some((n) => typeof n !== 'string')) {
    throw new Error(`${origin}: "disable" must be an array of rule names`)
  }

  // A misspelled rule name would otherwise fail silently and leave the rule
  // running, which is the opposite of what the config author intended.
  for (const name of disable as string[]) {
    if (!RULE_NAMES.includes(name)) {
      throw new Error(`${origin}: unknown rule "${name}" (known: ${RULE_NAMES.join(', ')})`)
    }
  }

  return { disabled: new Set(disable as string[]) }
}

// An explicit path must exist. The default file is optional, so running the
// linter in a directory without one just uses every rule.
export function loadConfig(explicitPath: string | undefined, cwd: string): Config {
  const path = resolve(cwd, explicitPath ?? DEFAULT_CONFIG_NAME)
  if (!existsSync(path)) {
    if (explicitPath !== undefined) {
      throw new Error(`config file not found: ${explicitPath}`)
    }
    return { disabled: new Set() }
  }
  return parseConfig(readFileSync(path, 'utf8'), explicitPath ?? DEFAULT_CONFIG_NAME)
}

export function applyConfig(findings: Finding[], config: Config): Finding[] {
  return findings.filter((f) => !config.disabled.has(f.rule))
}
