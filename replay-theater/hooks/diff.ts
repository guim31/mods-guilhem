// Diff unifié ligne à ligne (plus longue sous-suite commune), en hunks « @@ -a,b +c,d @@ ».

type Op = { t: ' ' | '-' | '+'; ligne: string }

// Au-delà de ce nombre de cellules, on renonce à l'alignement fin : bloc supprimé puis bloc ajouté.
const MAX_CELLULES = 4_000_000

const aligner = (a: string[], b: string[]): Op[] => {
  const n = a.length
  const m = b.length
  if (n * m > MAX_CELLULES) {
    return [...a.map(ligne => ({ t: '-' as const, ligne })), ...b.map(ligne => ({ t: '+' as const, ligne }))]
  }
  const l = new Int32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      l[i * (m + 1) + j] =
        a[i] === b[j] ? l[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(l[(i + 1) * (m + 1) + j]!, l[i * (m + 1) + j + 1]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', ligne: a[i]! })
      i++
      j++
    } else if (l[(i + 1) * (m + 1) + j]! >= l[i * (m + 1) + j + 1]!) ops.push({ t: '-', ligne: a[i++]! })
    else ops.push({ t: '+', ligne: b[j++]! })
  }
  while (i < n) ops.push({ t: '-', ligne: a[i++]! })
  while (j < m) ops.push({ t: '+', ligne: b[j++]! })
  return ops
}

const lignes = (texte: string | null) => (texte === null || texte === '' ? [] : texte.split('\n'))

export type Diff = { texte: string; ajouts: number; suppressions: number }

export const diffUnifie = (avant: string | null, apres: string | null, contexte = 3): Diff => {
  const a = lignes(avant)
  const b = lignes(apres)
  let debut = 0
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++
  let fin = 0
  while (fin < a.length - debut && fin < b.length - debut && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++

  const ops: Op[] = [
    ...a.slice(0, debut).map(ligne => ({ t: ' ' as const, ligne })),
    ...aligner(a.slice(debut, a.length - fin), b.slice(debut, b.length - fin)),
    ...a.slice(a.length - fin).map(ligne => ({ t: ' ' as const, ligne })),
  ]

  // Plages à montrer : chaque changement avec son contexte, plages voisines fusionnées.
  const plages: [number, number][] = []
  ops.forEach((op, k) => {
    if (op.t === ' ') return
    const de = Math.max(0, k - contexte)
    const a2 = Math.min(ops.length - 1, k + contexte)
    const derniere = plages[plages.length - 1]
    if (derniere && de <= derniere[1] + 1) derniere[1] = Math.max(derniere[1], a2)
    else plages.push([de, a2])
  })

  // Numéros de ligne (avant, après) au début de chaque op.
  const posA: number[] = []
  const posB: number[] = []
  let x = 1
  let y = 1
  for (const op of ops) {
    posA.push(x)
    posB.push(y)
    if (op.t !== '+') x++
    if (op.t !== '-') y++
  }

  const hunks = plages.map(([de, a2]) => {
    const tranche = ops.slice(de, a2 + 1)
    const nA = tranche.filter(o => o.t !== '+').length
    const nB = tranche.filter(o => o.t !== '-').length
    const tete = `@@ -${nA ? posA[de] : posA[de]! - 1},${nA} +${nB ? posB[de] : posB[de]! - 1},${nB} @@`
    return [tete, ...tranche.map(o => o.t + o.ligne)].join('\n')
  })

  return {
    texte: hunks.join('\n'),
    ajouts: ops.filter(o => o.t === '+').length,
    suppressions: ops.filter(o => o.t === '-').length,
  }
}
