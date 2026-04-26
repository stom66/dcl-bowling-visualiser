/**
 * Replaces leading 2-space groups with one tab per level (project convention).
 * Skips lines that do not start with a space. Idempotent on tab-indented files.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(process.cwd(), 'src')

function convertLine(line) {
	let i = 0
	while (i < line.length && line[i] === ' ') {
		i += 1
	}
	if (i === 0) {
		return line
	}
	const levels = Math.floor(i / 2)
	const rem = i % 2
	return '\t'.repeat(levels) + (rem ? ' ' : '') + line.slice(i)
}

async function walk(dir) {
	const out = []
	for (const name of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, name.name)
		if (name.isDirectory()) {
			out.push(...(await walk(p)))
		}
		else if (/\.(ts|vue|css)$/.test(name.name)) {
			out.push(p)
		}
	}
	return out
}

async function main() {
	const files = await walk(root)
	let changed = 0
	for (const file of files) {
		const raw = await readFile(file, 'utf8')
		const next = raw.split(/\r?\n/).map(convertLine).join('\n')
		if (next !== raw) {
			await writeFile(file, next, 'utf8')
			changed += 1
			console.log(file)
		}
	}
	console.log(`Updated ${changed} file(s).`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
