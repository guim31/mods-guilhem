import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mode } from '../types'

// Textes des réponses finales (synthèses), normalisés, les plus récents en dernier.
const finals = atom({ plugin: 'apparence', key: 'finals' } as const, [])
const mode = atom({ plugin: 'apparence', key: 'mode' } as const, 'distinct')
// Le mode partage d'écran du mod screen-share, quand il tourne.
const partageEcran = { plugin: 'screen-share', key: 'reglage' } as const

const MODES: Mode[] = ['distinct', 'compact', 'off']
const KEEP = 400

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

const remember = (list: string[], text: string) => {
  const one = norm(text)
  if (!one || list.includes(one)) return list
  return [...list, one].slice(-KEEP)
}

// Un bloc est la synthèse s'il fait partie de la réponse finale d'un tour terminé.
const isFinal = (list: string[], text: string) => {
  const one = norm(text)
  return one.length > 0 && list.some(answer => answer === one || answer.includes(one))
}

// Marques que le modèle écrit lui-même (~/.claude/CLAUDE.md), pour les affichages
// où le mod ne dessine pas : le web, le mobile, le cloud.
const SYNTHESE = /^\s*\*\*◆ Synthèse\*\*[ \t]*\n+/
const ETAPE = /^\s*⋯[ \t]*/

const marks = (text: string) => {
  if (SYNTHESE.test(text)) return { kind: 'final' as const, text: text.replace(SYNTHESE, '') }
  if (ETAPE.test(text)) return { kind: 'etape' as const, text: text.replace(ETAPE, '') }
  return { kind: undefined, text }
}

const firstLine = (text: string) => {
  const line = text.split('\n').find(l => l.trim()) ?? ''
  return line.replace(/^[#>*\-\s]+/, '').slice(0, 140)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'apparence',
      description: 'Style des échanges : distinct | compact | off (sans argument : bascule)',
    })

    // Le style choisi avec /apparence est gardé d'une session à l'autre.
    const saved = await $.store.get('mode')
    if (MODES.includes(saved as Mode)) await update($, mode, () => saved as Mode)

    // Reconstitue les synthèses des tours déjà présents (session reprise, rechargement du mod).
    const messages = await $.session.messages()
    let last = ''
    let seeded: string[] = []
    for (const m of messages) {
      if (m.role === 'assistant') {
        if (m.text.trim()) last = m.text
      } else if (!m.toolResults?.length && last) {
        seeded = remember(seeded, last)
        last = ''
      }
    }
    if (last) seeded = remember(seeded, last)
    await update($, finals, list => seeded.reduce(remember, list))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.answer) {
      await update($, finals, list => remember(list, e.answer))
    }
    return next(e)
  })

  on('command.run', { command: 'apparence' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase() as Mode
    const current = await read($, mode)
    const chosen = MODES.includes(asked)
      ? asked
      : MODES[(MODES.indexOf(current) + 1) % MODES.length]!
    await update($, mode, () => chosen)
    await $.store.set('mode', chosen)
    const what = {
      distinct: 'travail intermédiaire en retrait et grisé, synthèse encadrée',
      compact: 'travail intermédiaire réduit à une ligne, synthèse encadrée',
      off: 'apparence d’origine',
    }[chosen]
    return { text: `Apparence : **${chosen}** — ${what}.` }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off') return next(e)
    // Partage d'écran en cours : on laisse screen-share masquer le texte, sans style.
    if ((await $.state.get(partageEcran)).value?.actif) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const marked = marks(e.props.text)
    const text = marked.text
    const final =
      !e.props.isSummary &&
      (marked.kind === 'final' || (marked.kind === undefined && isFinal(await read($, finals), text)))

    if (final) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginY={1}>
          <Text bold color="claude">◆ Synthèse</Text>
          <Markdown text={text} />
        </Box>
      )
    }

    if (current === 'compact') {
      return (
        <Box key="etape" flexDirection="column" paddingLeft={2}>
          <Text dimColor italic wrap="truncate-end">⋯ {firstLine(text)}</Text>
          <Box display="none" hover={{ display: 'flex' }} paddingLeft={2}>
            <Markdown text={text} dimColor />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor italic>⋯ travail en cours</Text>
        <Box paddingLeft={2}>
          <Markdown text={text} dimColor />
        </Box>
      </Box>
    )
  })
}
