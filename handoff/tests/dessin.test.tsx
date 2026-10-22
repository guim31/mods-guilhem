import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'handoff',
  component: 'Pane',
  requestId: 'handoff',
  props: { title: 'Handoff', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('/handoff rédige le prompt, l’enregistre et propose un nouveau chat', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 14, 32) })
  mock.env(on, { HOME: '/home/test' })
  const ecrits: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('model.fork', () => ({ value: { isAnswered: true as const, text: '# Handoff : essai\n\n## Objectif\nFinir.', usage: USAGE } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
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
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'nouveau' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mots/ })).toBeDefined()
    await ui.unmount()
  }
})
