import { describe, expect, mock, test } from 'claude-code/testing'

const props = (text: string) => ({ text, isFirstOfReply: false })

describe('apparence', () => {
  test('travail intermédiaire puis synthèse encadrée', async ($, on) => {
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>moteur</Text>
    })
    const ui = await $.ui.mount({
      plugin: 'apparence',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: props('Je lis le fichier.'),
    })
    expect(await ui.find({ text: /travail en cours/ })).toBeDefined()
    expect(await ui.find({ text: /Synthèse/ })).toBeUndefined()

    await $.turn.complete({
      answer: 'Voici la synthèse finale.',
      durationMs: 10,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    })
    const fin = await $.ui.mount({
      plugin: 'apparence',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: props('Voici la synthèse finale.'),
    })
    expect(await fin.find({ text: /Synthèse/ })).toBeDefined()
    expect(await ui.find({ text: /travail en cours/ })).toBeDefined()
  })

  test('/apparence off rend l’apparence d’origine', async ($, on) => {
    mock.store(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>moteur</Text>
    })
    await $.command.run({
      command: 'apparence',
      args: 'off',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    const ui = await $.ui.mount({
      plugin: 'apparence',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: props('Étape.'),
    })
    expect(await ui.find({ text: /travail en cours/ })).toBeUndefined()
    expect(await ui.find({ text: /moteur/ })).toBeDefined()
  })

  test('le style enregistré est repris au démarrage de la session', async ($, on) => {
    mock.store(on, { mode: 'off' })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', () => ({ value: undefined }) as never)
    on('session.messages', () => ({ value: [] }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>moteur</Text>
    })
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'apparence',
      surface: 'mobile',
      component: 'AssistantMessage',
      props: props('Étape.'),
    })
    expect(await ui.find({ text: /moteur/ })).toBeDefined()
  })

  test('/apparence enregistre le choix', async ($, on) => {
    let saved: unknown
    on('store.set', (_$, e) => {
      saved = e.value
      return { value: undefined }
    })
    await $.command.run({
      command: 'apparence',
      args: 'compact',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(saved).toBe('compact')
  })

  test('les marques écrites par le modèle décident et sont retirées', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>moteur</Text>
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const fin = await $.ui.mount({
        plugin: 'apparence',
        surface,
        component: 'AssistantMessage',
        props: props('**◆ Synthèse**\n\nTout est fait.'),
      })
      expect(await fin.find({ text: /^◆ Synthèse$/ })).toBeDefined()
      expect(await fin.find({ text: /\*\*◆/ })).toBeUndefined()

      const etape = await $.ui.mount({
        plugin: 'apparence',
        surface,
        component: 'AssistantMessage',
        props: props('⋯ Je lis le fichier.'),
      })
      expect(await etape.find({ text: /travail en cours/ })).toBeDefined()
      expect(await etape.find({ text: /^Je lis le fichier\.$/ })).toBeDefined()
    }
  })
})
