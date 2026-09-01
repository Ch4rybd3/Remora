#!/usr/bin/env node
/**
 * The English-only gate, for French that carries no accent.
 *
 * CI already rejects accented characters in source. That check has now missed
 * French seven times in this project - "Scanner", "Fichiers", "Effacer",
 * "Identifiants incorrects", "Mot de passe", "en attente", "Voir", "Envoyer".
 * None of them carry an accent, and all of them reached the interface.
 *
 * So this matches whole words instead. The list is deliberately short: every
 * entry has to be a word that would never legitimately appear in English UI
 * text, because a gate that cries wolf gets disabled.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

/**
 * Words that are French and cannot be English. Checked case-insensitively as
 * whole words.
 *
 * Not included on purpose: "note", "message", "important", "date", "double",
 * "instance", "simple", "table", "type", "certificate" - all identical in both
 * languages. Nor "scan"/"scanner", which is English and appears in
 * `windows.psscan - Pool Scanner`.
 */
const FRENCH = [
  'aucun', 'aucune', 'ajouter', 'annuler', 'attente', 'charger', 'chargement',
  'chercher', 'cliquez', 'coller', 'copier', 'effacer', 'enregistrer',
  'envoyer', 'erreur', 'fermer', 'fichier', 'fichiers', 'impossible',
  'modifier', 'nouveau', 'nouvelle', 'ouvrir', 'parametres', 'precedent',
  'rechercher', 'recherche', 'reussi', 'selectionner', 'supprimer',
  'telecharger', 'terminer', 'valider', 'veuillez', 'voir',
  'identifiants', 'connexion', 'deconnexion', 'utilisateur', 'utilisateurs',
  'exemples', 'ligne', 'lignes', 'colonne', 'colonnes', 'apercu',
]

const PATTERN = new RegExp(`(?<![\\w-])(${FRENCH.join('|')})(?![\\w-])`, 'gi')

/**
 * French byte units, which no word list can catch.
 *
 * `o` is octet, and `Ko`/`Mo`/`Go` are its multiples. As bare words they are
 * unmatchable - `o` appears inside every other identifier and `Go` is an
 * English verb - so they are caught in the one shape that is unambiguous: a
 * number, a space, then the unit. Two shipped pages formatted every file size
 * this way and both the accent gate and the word list read them as English.
 *
 * `frontend/src/utils/formatUtils.ts` has the correct formatter. Use it rather
 * than writing a third one.
 */
const BYTE_UNITS = /\}\s*(o|Ko|Mo|Go|To)(?![\w-])/g

/** Lines that are allowed to contain these words. */
function exempt(line) {
  // An import path or a URL is not user-facing text.
  return /^\s*(import|from)\s/.test(line) || /https?:\/\//.test(line)
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const findings = []
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (exempt(line)) return
    for (const match of line.matchAll(PATTERN)) {
      findings.push({
        file: relative(ROOT, file),
        line: index + 1,
        word: match[0],
        text: line.trim().slice(0, 100),
      })
    }
    for (const match of line.matchAll(BYTE_UNITS)) {
      findings.push({
        file: relative(ROOT, file),
        line: index + 1,
        word: `${match[1]} (French byte unit - use fmtBytes from utils/formatUtils)`,
        text: line.trim().slice(0, 100),
      })
    }
  })
}

console.log('English-only check\n')
if (findings.length === 0) {
  console.log('      0  total\n')
  process.exit(0)
}

for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  "${f.word}"`)
  console.log(`      ${f.text}`)
}
console.log(`\n  ${findings.length} French word(s) in source. See docs/CONVENTIONS.md section 1.`)
process.exit(1)
