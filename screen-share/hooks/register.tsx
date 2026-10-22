import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { masquer, masquerArbre, masquerValeur } from './masque'

const reglage = atom({ plugin: 'screen-share', key: 'reglage' } as const, { actif: false, mots: [] })

const statut = ($: EngineInterface, actif: boolean) =>
  $.ui.status(actif ? '🔒 partage d’écran : noms, e-mails, téléphones et montants masqués' : undefined)

const enregistrer = async ($: EngineInterface, actif: boolean, mots: string[]) => {
  await update($, reglage, () => ({ actif, mots }))
  await $.store.set('actif', actif)
  await $.store.set('mots', mots)
  statut($, actif)
}

// Un arbre rendu par un autre que l'engine : on masque aussi ce qu'il dessine.
const arbre = (tree: RenderElement, mots: readonly string[]) => masquerArbre(tree, mots) as RenderElement

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'screenshare',
      description: 'Partage d’écran : masque noms, e-mails, téléphones, montants (on | off | ajouter <mot> | retirer <mot> | liste)',
      argumentHint: '[on|off|ajouter <mot>|retirer <mot>|liste]',
      immediate: true,
    })
    const actif = (await $.store.get('actif')) === true
    const mots = ((await $.store.get('mots')) as string[] | undefined) ?? []
    // Ton propre nom, tel que git le connaît, est masqué d'office.
    for (const cle of ['user.name', 'user.email']) {
      const r = await $.process.run(['git', 'config', '--global', cle]).catch(() => undefined)
      const valeur = r?.stdout.trim()
      if (valeur && !mots.includes(valeur)) mots.push(valeur)
    }
    await update($, reglage, () => ({ actif, mots }))
    statut($, actif)
    return next(e)
  })

  on('command.run', { command: 'screenshare' }, async ($, e) => {
    const { actif, mots } = await read($, reglage)
    const [action, ...reste] = e.args.trim().split(/\s+/)
    const mot = reste.join(' ').trim()
    if (action === 'ajouter' && mot) {
      await enregistrer($, actif, [...new Set([...mots, mot])])
      return { text: `« ${masquer(mot, [mot])} » sera masqué.` }
    }
    if (action === 'retirer' && mot) {
      await enregistrer($, actif, mots.filter(m => m.toLowerCase() !== mot.toLowerCase()))
      return { text: 'Mot retiré de la liste.' }
    }
    if (action === 'liste') {
      return { text: mots.length ? `Mots masqués en plus des motifs : ${mots.length} (non affichés).` : 'Aucun mot ajouté.' }
    }
    const voulu = action === 'on' ? true : action === 'off' ? false : !actif
    await enregistrer($, voulu, mots)
    return {
      text: voulu
        ? 'Mode partage d’écran **activé** : noms, e-mails, téléphones, montants, IBAN, adresses et IP sont masqués à l’affichage. Claude lit toujours le texte intact. `/screenshare off` pour revenir.'
        : 'Mode partage d’écran **désactivé**.',
    }
  })

  // Les rangées du transcript : on réécrit leurs textes avant que l'engine (ou un autre mod) les dessine.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return arbre(await next({ ...e, props: { ...e.props, text: masquer(e.props.text, mots) } }), mots)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return arbre(await next({ ...e, props: { ...e.props, text: masquer(e.props.text, mots) } }), mots)
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return arbre(await next({ ...e, props: { ...e.props, text: masquer(e.props.text, mots) } }), mots)
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return arbre(await next({ ...e, props: { ...e.props, text: masquer(e.props.text, mots) } }), mots)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    const props = { ...e.props, input: masquerValeur(e.props.input, mots) }
    if (e.props.output !== undefined) props.output = masquerValeur(e.props.output, mots)
    return arbre(await next({ ...e, props }), mots)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return arbre(await next({ ...e, props: { ...e.props, output: masquerValeur(e.props.output, mots) } }), mots)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    const calls = masquerValeur(e.props.calls, mots) as typeof e.props.calls
    return arbre(await next({ ...e, props: { ...e.props, calls } }), mots)
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    if (!actif) return next(e)
    return next({ ...e, props: { ...e.props, questions: masquerValeur(e.props.questions, mots) as unknown[] } })
  })

  // Panneaux et bandeau des autres mods placés sous celui-ci.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    return actif ? arbre(await next(e), mots) : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { actif, mots } = await read($, reglage)
    return actif ? arbre(await next(e), mots) : next(e)
  })
}
