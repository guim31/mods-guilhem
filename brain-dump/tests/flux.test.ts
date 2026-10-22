import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const HUMAIN = { wait: false, origin: { kind: 'composer' as const } }
const DUMP = Array.from({ length: 30 }, () => 'euh donc du coup je voudrais que le site affiche les rendez-vous').join(' ')

test('un prompt court passe tel quel, sans appel au modèle', async ($, on) => {
  mock.store(on)
  let appels = 0
  on('model.complete', () => {
    appels++
    return { value: { isAnswered: true as const, text: '{}', usage: USAGE } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const r = await $.prompt.submit({ text: 'Corrige la faute dans le titre.', ...HUMAIN })
  expect(r.text).toBe('Corrige la faute dans le titre.')
  expect(appels).toBe(0)
})

test('un brain dump est réécrit, le texte dicté reste en contexte', async ($, on) => {
  mock.store(on)
  const reponses = [
    JSON.stringify({ brain_dump: true, questions: [{ header: 'Vue', question: 'Quelle vue ?', options: ['Semaine', 'Mois'] }] }),
    '**Tâche** : afficher les rendez-vous en vue semaine.',
  ]
  on('model.complete', () => ({ value: { isAnswered: true as const, text: reponses.shift() ?? '', usage: USAGE } }))
  const posees: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    posees.push(q.question)
    const choix = q.question === 'Quelle vue ?' ? 'Semaine' : 'Envoyer le prompt structuré'
    return { result: { questions: e.questions, answers: { [q.question]: choix } } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const r = await $.prompt.submit({ text: DUMP, ...HUMAIN })
  expect(posees).toEqual(['Quelle vue ?', 'Prompt structuré prêt. Que faire ?'])
  expect(r.text).toBe('**Tâche** : afficher les rendez-vous en vue semaine.')
  expect(r.context?.[0]).toContain('du coup je voudrais')
})

test('le préfixe brut: envoie le texte tel quel', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const r = await $.prompt.submit({ text: `brut: ${DUMP}`, ...HUMAIN })
  expect(r.text).toBe(DUMP)
})
