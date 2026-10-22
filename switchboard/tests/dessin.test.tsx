import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'switchboard',
  component: 'Pane',
  requestId: 'switchboard',
  props: { title: 'Mods', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const INSTALLES = JSON.stringify({
  version: 2,
  plugins: {
    'apparence@mods-guilhem': [{ installPath: '/p/apparence' }],
    'notes@ailleurs': [{ installPath: '/p/notes' }],
  },
})

test('/mods liste les mods, coupe un plugin installé dans enabledPlugins', async ($, on) => {
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  let reglages = JSON.stringify({ theme: 'dark', enabledPlugins: { 'apparence@mods-guilhem': true, 'notes@ailleurs': true } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('settings.read', () => ({ value: JSON.parse(reglages).enabledPlugins }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('installed_plugins.json')) return { value: INSTALLES }
    if (e.path === '/p/apparence/hooks/hooks.json') return { value: '{ "modules": ["./register.tsx"] }' }
    if (e.path.endsWith('settings.json')) return { value: reglages }
    return { deny: 'absent' }
  })
  on('fs.write', (_, e) => {
    reglages = e.text
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1 mods actifs sur 1/ })).toBeDefined()
  await ui.press({ key: 'bascule:apparence@mods-guilhem' })
  expect(JSON.parse(reglages).enabledPlugins['apparence@mods-guilhem']).toBe(false)
  expect(JSON.parse(reglages).theme).toBe('dark')
  expect(await ui.find({ key: 'recharger' })).toBeDefined()
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /0 mods actifs sur 1/ })).toBeDefined()
  await term.unmount()
})
