import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'chat-inventory',
  component: 'Pane',
  requestId: 'chat-inventory',
  props: { title: 'Dans ce chat', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('le panneau dessine des cartes : objectif, tâches, skills, fichiers et outils', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.messages', () => ({ value: [] }))
  on('env.get', () => ({ value: '/srv' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { type: 'create' } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Contexte :\nun long préambule\nTâche : Prépare le rapport client du trimestre', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Collecter', status: 'in_progress', activeForm: 'Collecte' }] })
  await $.tool.call({ tool: 'Skill', skill: 'xlsx' })
  await $.tool.call({ tool: 'Read', file_path: '/srv/data/ventes.csv' })
  await $.tool.call({ tool: 'Write', file_path: '/srv/out/rapport.md', content: 'x' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Prépare le rapport client du trimestre$/ })).toBeDefined()
    expect(await ui.find({ key: 'taches' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0\/1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /étape 1 sur 1/ })).toBeDefined()
    expect(await ui.find({ key: 'skill:xlsx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^rapport\.md$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^~\/data$/ })).toBeDefined()
    expect(await ui.find({ key: 'outil:Write' })).toBeDefined()
    // L'anneau animé sur le bureau, la barre de crans dans le terminal.
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /▱/ })).toBeDefined()
    await ui.unmount()
  }
})
