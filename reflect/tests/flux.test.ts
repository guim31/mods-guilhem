import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

test('une règle durable est repérée puis enregistrée dans la mémoire auto', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22) })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  const fichiers: Record<string, string> = {}
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true as const,
      text: JSON.stringify({
        regle: true,
        texte: 'Ne jamais utiliser de tiret cadratin.',
        application: 'Dans tous les textes rédigés.',
        titre: 'pas-de-tiret-cadratin',
        portee: 'globale',
      }),
      usage: USAGE,
    },
  }))
  on('session.cwd', () => ({ value: '/mnt/DOCS/_PROJET' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', (_, e) => ({ value: e.path in fichiers }))
  on('fs.read', (_, e) => (e.path in fichiers ? { value: fichiers[e.path]! } : { deny: 'absent' }))
  on('fs.write', (_, e) => {
    fichiers[e.path] = e.text
    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Mémoire auto' } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Et à partir de maintenant, n’utilise jamais de tiret cadratin.', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  await clock.settle()
  expect((await $.command.run({ command: 'reflect', args: '', ...CMD })).text).toContain('En attente')

  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.advance(1000)
  await clock.settle()

  const dossier = '/home/test/.claude/projects/-mnt-DOCS--PROJET/memory'
  expect(fichiers[`${dossier}/pas-de-tiret-cadratin.md`]).toContain('type: feedback')
  expect(fichiers[`${dossier}/MEMORY.md`]).toContain('[pas-de-tiret-cadratin](pas-de-tiret-cadratin.md)')
})
