import { expect, mock, test } from 'claude-code/testing'

const SITE = { scroll: { offset: 0, bodyRows: 20 }, view: {} }
const BAND = {
  plugin: 'helper-desk',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 5, bodyColumns: 100, ...SITE },
} as const
const PANE = {
  plugin: 'helper-desk',
  component: 'Pane',
  requestId: 'helper-desk',
  props: { title: 'Sous-agents', isFocused: false, bodyColumns: 60, placement: 'dock', ...SITE },
} as const

test('la barre violette suit la liste des tâches, et le panneau se dessine', async ($, on) => {
  on('command.register', () => ({ value: { command: 'helper-desk' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Lire', status: 'completed', activeForm: 'Lecture' },
      { content: 'Écrire', status: 'in_progress', activeForm: 'Écriture du code' },
      { content: 'Tester', status: 'pending', activeForm: 'Tests' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /1\/3/ }))?.text).toContain('Écriture du code')
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /Aucun sous-agent/ })).toBeDefined()
    await pane.unmount()
  }
})

test('un sous-agent a son crabe, sa barre et son coût', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'helper-desk' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Analyse du code', type: 'Explore', status: 'running' as const }],
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x.ts', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/tmp/y.ts', agentId: 'a1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /Analyse du code/ })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /2 outils/ }))?.text).toContain('y.ts')
    await pane.unmount()
  }
})
