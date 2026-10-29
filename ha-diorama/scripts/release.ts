// Prepares a release: raises the version in package.json, moves what is
// under Unreleased in CHANGELOG.md under the new version, and writes those
// notes to a file for the GitHub release. The release workflow runs it, and
// it can be run by hand to see what a release would do:
//
//   pnpm release --bump patch|minor|major [--notes notes.md]
//   pnpm release --version 1.2.0 [--notes notes.md]
//
// It only changes files. Building, committing, tagging and publishing are
// the workflow's job, so a run by hand can be undone with git checkout.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'

const REPO = 'https://github.com/CarlesRojas/ha-diorama'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '')

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// The version. An exact one wins over a bump.
const pkgPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
const current = pkg.version
const exact = args.get('version')?.trim()
let next: string
if (exact) {
  if (!/^\d+\.\d+\.\d+$/.test(exact)) fail(`Version must look like 1.2.3, got "${exact}"`)
  next = exact
} else {
  const bump = args.get('bump') ?? 'patch'
  const [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') next = `${major + 1}.0.0`
  else if (bump === 'minor') next = `${major}.${minor + 1}.0`
  else if (bump === 'patch') next = `${major}.${minor}.${patch + 1}`
  else next = fail(`Bump must be patch, minor or major, got "${bump}"`)
}
if (next === current) fail(`Version ${next} is already the current one`)

// The changelog. Everything between the Unreleased heading and the next
// version heading becomes the new version's section and the release notes.
const logPath = new URL('../CHANGELOG.md', import.meta.url)
const log = readFileSync(logPath, 'utf8')
const unreleased = log.indexOf('## [Unreleased]')
if (unreleased < 0) fail('CHANGELOG.md has no "## [Unreleased]" section')
const afterHeading = log.indexOf('\n', unreleased) + 1
const rest = log.slice(afterHeading)
const nextHeading = rest.search(/^## \[/m)
const linkRefs = rest.search(/^\[Unreleased\]:/m)
const end = [nextHeading, linkRefs].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), rest.length)
const notes = rest.slice(0, end).trim()
if (!notes) fail('Nothing is listed under Unreleased in CHANGELOG.md, so there is nothing to release')

const today = new Date().toISOString().slice(0, 10)
const section = `## [Unreleased]\n\n## [${next}] - ${today}\n\n${notes}\n\n`
let updated = log.slice(0, unreleased) + section + rest.slice(end)
// The comparison links at the bottom. Unreleased now compares against the
// new tag, and the new tag against the one before it, if there was one.
const previous = current === '0.0.0' ? null : `v${current}`
const nextLinks = [
  `[Unreleased]: ${REPO}/compare/v${next}...HEAD`,
  previous ? `[${next}]: ${REPO}/compare/${previous}...v${next}` : `[${next}]: ${REPO}/releases/tag/v${next}`,
].join('\n')
updated = /^\[Unreleased\]:.*$/m.test(updated)
  ? updated.replace(/^\[Unreleased\]:.*$/m, nextLinks)
  : `${updated.trimEnd()}\n\n${nextLinks}\n`

writeFileSync(logPath, updated)
writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: next }, null, 2) + '\n')
const notesPath = args.get('notes')
if (notesPath) writeFileSync(notesPath, notes + '\n')
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`)
console.log(`${current} -> ${next}`)
