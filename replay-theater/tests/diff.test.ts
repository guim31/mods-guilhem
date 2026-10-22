import { expect, test } from 'claude-code/testing'

import { diffUnifie } from '../hooks/diff'

test('un remplacement au milieu donne un hunk avec son contexte', async () => {
  const avant = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
  const apres = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n')
  const d = diffUnifie(avant, apres)
  expect(d.ajouts).toBe(1)
  expect(d.suppressions).toBe(1)
  expect(d.texte).toBe(['@@ -1,7 +1,7 @@', ' a', ' b', ' c', '-d', '+D', ' e', ' f', ' g'].join('\n'))
})

test('un fichier créé', async () => {
  const d = diffUnifie(null, 'un\ndeux')
  expect(d.texte).toBe(['@@ -0,0 +1,2 @@', '+un', '+deux'].join('\n'))
})

test('deux changements éloignés font deux hunks', async () => {
  const base = Array.from({ length: 20 }, (_, i) => `l${i}`)
  const modif = [...base]
  modif[1] = 'X'
  modif[18] = 'Y'
  const d = diffUnifie(base.join('\n'), modif.join('\n'))
  expect(d.texte.split('\n').filter(l => l.startsWith('@@')).length).toBe(2)
})

test('aucun changement, aucun hunk', async () => {
  expect(diffUnifie('a\nb', 'a\nb').texte).toBe('')
})
