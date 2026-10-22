import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 2_000, model: 'claude-opus-5-5' }

test('après une réponse, le compte à rebours ; une fois froid, le coût de la relecture', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  const lignes: (string | undefined)[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.stat', () => ({ deny: 'absent' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 122_010, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.status', (_, e) => {
    lignes.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', usage: USAGE, reason: 'answer' })
  await clock.settle()
  expect(lignes.at(-1)).toContain('froid dans 1 h')

  await clock.advance(61 * 60_000)
  await clock.settle()
  expect(lignes.at(-1)).toContain('122 k tokens relus plein tarif')

  const r = await $.command.run({ command: 'keepwarm', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
  expect(r.text).toContain('déjà froid')
})
