import { expect, test } from 'claude-code/testing'

import { masquer, masquerValeur } from '../hooks/masque'

test('les données personnelles deviennent des barres', async () => {
  const texte =
    'Écris à camille.durand@exemple.fr ou au 06 12 34 56 78 (+33 6 12 34 56 78). Facture de 1 250 € et $3,400. ' +
    'IBAN FR76 3000 6000 0112 3456 7890 189, NAS en 192.0.2.10, au 12 rue des Lilas.'
  const out = masquer(texte)
  for (const fuite of ['camille', '06 12', '+33', '1 250', '3,400', 'FR76', '192.0.2', 'rue des Lilas']) {
    expect(out.includes(fuite)).toBe(false)
  }
  expect(out.includes('▇')).toBe(true)
})

test('les noms de personnes, pas les produits', async () => {
  const out = masquer('Le rendez-vous avec Camille Durand et Mme Martin. Claude Code tourne sur Remote Control.')
  expect(out.includes('Camille')).toBe(false)
  expect(out.includes('Durand')).toBe(false)
  expect(out.includes('Martin')).toBe(false)
  expect(out.includes('Claude Code')).toBe(true)
  expect(out.includes('Remote Control')).toBe(true)
  expect(out.startsWith('Le rendez-vous')).toBe(true)
})

test('les mots ajoutés et le nom dans les chemins', async () => {
  const out = masquer('Projet GHosteo dans /home/guilhem/site', ['GHosteo'])
  expect(out.includes('GHosteo')).toBe(false)
  expect(out.includes('guilhem')).toBe(false)
  expect(out.includes('/home/')).toBe(true)
})

test('une entrée d’outil garde sa structure', async () => {
  const out = masquerValeur({ to: ['bob@x.io'], n: 3, ok: true }, []) as { to: string[]; n: number; ok: boolean }
  expect(out.n).toBe(3)
  expect(out.ok).toBe(true)
  expect(out.to[0]!.includes('@')).toBe(false)
})
