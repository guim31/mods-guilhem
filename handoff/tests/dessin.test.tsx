import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'handoff',
  component: 'Pane',
  requestId: 'handoff',
  props: { title: 'Handoff', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PROCESS_OK = { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

test('/handoff rédige le prompt, l’enregistre, passe au premier plan et prévient', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 14, 32) })
  mock.env(on, { HOME: '/home/test' })
  const ecrits: string[] = []
  const ouvertures: (true | undefined)[] = []
  const toasts: string[] = []
  const commandes: string[][] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    ouvertures.push(e.focus)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('model.fork', () => ({ value: { isAnswered: true as const, text: '# Handoff : essai\n\n## Objectif\nFinir.', usage: USAGE } }))
  on('process.run', (_, e) => {
    commandes.push([...e.argv])
    return PROCESS_OK
  })
  on('fs.write', (_, e) => {
    ecrits.push(e.path)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'handoff', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.advance(100)
  await clock.settle()

  expect(ecrits[0]).toBe('/home/test/.claude/handoffs/2026-10-22-14-32-abcdef12.md')
  expect(ouvertures.length > 0 && ouvertures.every(f => f === true)).toBe(true)
  expect(toasts.some(t => t.includes('Passation prête'))).toBe(true)
  expect(commandes.some(c => c[0] === 'notify-send')).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'nouveau' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Passation prête/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mots/ })).toBeDefined()
    await ui.unmount()
  }
})

test('rédaction ratée : le message retenu revient dans la zone de saisie', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 15, 0) })
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  const remplis: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [] }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 120_000, window: 1_000_000 }, rateLimits: [] } }))
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const, usage: USAGE } }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '', usage: USAGE } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Handoff vers un nouveau chat' } },
  }))
  on('prompt.fill', (_, e) => {
    remplis.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', usage: { ...USAGE, model: 'claude-opus-5-5' }, reason: 'answer' })
  await clock.advance(61 * 60_000)
  await clock.settle()
  await $.prompt.submit({ text: 'Ma question en attente', wait: false, origin: { kind: 'composer' } })
  await clock.advance(200)
  await clock.settle()

  expect(remplis).toEqual(['Ma question en attente'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /rédaction impossible/ })).toBeDefined()
  await ui.unmount()
})
