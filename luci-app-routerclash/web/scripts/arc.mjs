#!/usr/bin/env node
// Fetches the Arc components listed in ../arc.json into src/components/arc, then applies ../arc-overrides
// (files we rewrote) and ./arc-patches.mjs (small edits). Arc Pro is licensed, so the source is never
// committed: src/components/arc is ignored by git and rebuilt from the registry.
//
//   npm run arc               fetch again, replacing src/components/arc
//   node scripts/arc.mjs --if-missing   fetch only when src/components/arc does not exist (used by dev and build)
//
// Needs ARC_PRO_TOKEN, from the environment or from web/.env.local.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patches } from './arc-patches.mjs'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = '@components/arc/'

function write(root, rel, content) {
  if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error(`Refusing to write outside the Arc folder: ${rel}`)
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function applyPatches(root) {
  for (const { file, edits } of patches) {
    const target = path.join(root, file)
    if (!fs.existsSync(target)) throw new Error(`Patch target is missing from the registry source: ${file}`)
    let text = fs.readFileSync(target, 'utf8')
    for (const { find, replace } of edits) {
      const count = text.split(find).length - 1
      if (count !== 1) {
        throw new Error(`${file}: expected one match, found ${count}, for ${JSON.stringify(find.slice(0, 70))}. The registry source changed; update scripts/arc-patches.mjs.`)
      }
      text = text.replace(find, () => replace)
    }
    fs.writeFileSync(target, text)
  }
}

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
    }
  }
}

/** files: Map of path relative to src/components/arc to content. Builds the finished tree in `root`. */
export function assemble(files, root) {
  fs.rmSync(root, { recursive: true, force: true })
  for (const [rel, content] of files) write(root, rel, content)
  const overrides = path.join(web, 'arc-overrides')
  if (fs.existsSync(overrides)) copyTree(overrides, root)
  applyPatches(root)
}

async function getJson(url, token) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (response.status === 404) return null
      if (response.status === 401 || response.status === 403) throw new Error(`The registry refused ARC_PRO_TOKEN (${response.status}) for ${url}`)
      if (response.status >= 500) throw new Error(`Registry error ${response.status} for ${url}`)
      if (!response.ok) throw new Error(`Unexpected ${response.status} for ${url}`)
      return await response.json()
    } catch (error) {
      if (attempt >= 3 || /refused/.test(error.message)) throw error
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt))
    }
  }
}

async function fetchFiles(manifest, token) {
  const files = new Map()
  for (const name of manifest.items) {
    // Pro items first, the free registry has the rest
    const item = (await getJson(`${manifest.registry}/pro/${name}.json`, token)) ?? (await getJson(`${manifest.registry}/${name}.json`, token))
    if (!item) throw new Error(`${name} is in neither the Arc Pro nor the free registry`)
    for (const file of item.files ?? []) {
      if (!file.target?.startsWith(PREFIX)) throw new Error(`${name}: unexpected target ${file.target}`)
      files.set(file.target.slice(PREFIX.length), file.content)
    }
    console.log(`arc: ${name}`)
  }
  return files
}

async function main() {
  const root = path.join(web, 'src/components/arc')
  if (process.argv.includes('--if-missing') && fs.existsSync(path.join(root, 'foundation.css'))) return

  try {
    process.loadEnvFile(path.join(web, '.env.local'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const token = process.env.ARC_PRO_TOKEN
  if (!token) {
    console.error(`src/components/arc is missing and ARC_PRO_TOKEN is not set.
Arc Pro is licensed and not part of this repository. Put the token in luci-app-routerclash/web/.env.local
(ARC_PRO_TOKEN=...) or export it, then run: npm run arc`)
    process.exit(1)
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(web, 'arc.json'), 'utf8'))
  const files = await fetchFiles(manifest, token)
  // Assemble beside the real folder so a failed fetch or patch leaves the current copy alone
  const staging = `${root}.new`
  assemble(files, staging)
  fs.rmSync(root, { recursive: true, force: true })
  fs.renameSync(staging, root)
  console.log(`arc: ${files.size} files from the registry written to src/components/arc`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
