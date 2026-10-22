import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'replay-theater',
  component: 'Pane',
  requestId: 'replay',
  props: { title: 'Replay', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('chaque Edit est gardé et /replay montre le diff de l’étape', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let contenu = 'titre\nligne une\nfin'
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: contenu }))
  on('tool.call', (_, e) => {
    const x = e as unknown as { old_string: string; new_string: string }
    contenu = contenu.replace(x.old_string, x.new_string)
    return { result: {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/doc/lettre.md', old_string: 'ligne une', new_string: 'ligne 1' })
  await $.tool.call({ tool: 'Edit', file_path: '/doc/lettre.md', old_string: 'fin', new_string: 'Fin.' })
  await $.command.run({ command: 'replay', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /étape 1\/2/ })).toBeDefined()
    expect(await ui.find({ key: 'apres' })).toBeDefined()
    await ui.press({ key: 'fin' })
    expect(await ui.find({ type: 'Text', text: /étape 2\/2/ })).toBeDefined()
    await ui.press({ key: 'debut' })
    await ui.unmount()
  }
  await clock.advance(10_000)
})
