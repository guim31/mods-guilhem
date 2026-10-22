import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Inventaire } from '../types'

const inventaire = atom({ plugin: 'handoff', key: 'inventaire' } as const, {
  lus: [],
  ecrits: [],
  modifies: [],
  skills: {},
  outils: {},
  liens: [],
})
const passation = atom({ plugin: 'handoff', key: 'passation' } as const, {
  texte: null,
  fichier: null,
  enCours: false,
  erreur: null,
})
const suivi = atom({ plugin: 'handoff', key: 'suivi' } as const, { lastAt: null, alerteSeuil: false, froidPropose: null })
// L'horloge du mod cache-clock, quand il tourne (ses relances /keepwarm comptent comme de l'activité).
const horlogeCache = { plugin: 'cache-clock', key: 'horloge' } as const

const PANE = 'handoff'
const MIN = 60_000
const SEUIL_DEFAUT = 250_000
// Sous cette taille, relire un chat froid coûte peu : on ne propose rien.
const SEUIL_FROID = 60_000
const HUMAINS = ['composer', 'sdk', 'bridge']
// Un prompt de la personne (une origine absente n'est pas celle d'un mod).
const humain = (origin?: { kind: string }) => !origin || HUMAINS.includes(origin.kind)

type Entree = Record<string, unknown>

const ajouter = (liste: string[], x: unknown) =>
  typeof x === 'string' && x && !liste.includes(x) ? [...liste, x].slice(-300) : liste

const compter = (table: Record<string, number>, cle: string) => ({ ...table, [cle]: (table[cle] ?? 0) + 1 })

const noter = (inv: Inventaire, tool: string, input: Entree, creation: boolean): Inventaire => {
  const out = { ...inv, outils: compter(inv.outils, tool) }
  if (tool === 'Read') out.lus = ajouter(inv.lus, input.file_path)
  if (tool === 'Write') {
    if (creation) out.ecrits = ajouter(inv.ecrits, input.file_path)
    else out.modifies = ajouter(inv.modifies, input.file_path)
  }
  if (tool === 'Edit' || tool === 'NotebookEdit') out.modifies = ajouter(inv.modifies, input.file_path ?? input.notebook_path)
  if (tool === 'Skill' && typeof input.skill === 'string') out.skills = compter(inv.skills, input.skill)
  if (tool === 'WebFetch' || /navigate$/.test(tool)) out.liens = ajouter(inv.liens, input.url)
  return out
}

const enMarkdown = (inv: Inventaire) => {
  const liste = (titre: string, xs: string[]) => (xs.length ? `${titre} :\n${xs.map(x => `- ${x}`).join('\n')}` : '')
  const table = (titre: string, t: Record<string, number>) => {
    const xs = Object.entries(t).sort((a, b) => b[1] - a[1])
    return xs.length ? `${titre} : ${xs.map(([k, n]) => `${k} (${n})`).join(', ')}` : ''
  }
  return [
    liste('Fichiers créés', inv.ecrits),
    liste('Fichiers modifiés', inv.modifies),
    liste('Fichiers lus', inv.lus.slice(-80)),
    table('Skills utilisés', inv.skills),
    table('Outils et connecteurs appelés', inv.outils),
    liste('Liens consultés', inv.liens),
  ]
    .filter(Boolean)
    .join('\n\n')
}

const PROMPT_HANDOFF = (inv: string, consignes: string, enAttente: string) => `Rédige maintenant un PROMPT DE PASSATION (handoff) pour qu'une nouvelle session de Claude Code, qui ne verra rien de cette conversation, reprenne exactement où nous en sommes. N'appelle aucun outil et ne fais rien d'autre : renvoie uniquement ce prompt, en Markdown, dans la langue de la conversation, sans préambule.

Structure :
# Handoff : <sujet en quelques mots>
## Objectif : ce que la personne veut au final, et pourquoi.
## État actuel : ce qui est fait, ce qui est vérifié, ce qui ne l'est pas encore.
## Décisions prises : et leurs raisons, y compris ce qui a été essayé puis abandonné et pourquoi.
## Fichiers : chemins absolus, rôle de chacun, ce qui y a changé.
## Outils, skills, connecteurs et liens : ce qui a servi, comment s'en servir ici.
## Préférences et pièges : consignes exprimées par la personne, erreurs rencontrées, contraintes à respecter.
## Prochaines étapes : liste ordonnée, la première immédiatement faisable.
## Pour démarrer : la toute première action de la nouvelle session.

Sois précis et complet (noms exacts, commandes, valeurs, identifiants) : ce prompt sera la seule mémoire de la nouvelle session. Plus détaillé qu'un résumé de compaction.
${consignes ? `\nConsignes de la personne pour ce handoff : ${consignes}\n` : ''}${enAttente ? `\nTermine par une section « ## Message en attente » qui reprend mot pour mot ce message que la personne allait envoyer :\n<message>\n${enAttente}\n</message>\n` : ''}
Inventaire relevé automatiquement dans cette session :
${inv || '(rien de relevé)'}`

// Repli quand le fork du chat n'est pas possible : le transcript en texte, au modèle sonnet.
const transcriptTexte = async ($: EngineInterface) => {
  const messages = await $.session.messages()
  const lignes = messages.map(m => {
    const outils = m.toolUses.map(t => `[${t.tool} ${JSON.stringify(t.input).slice(0, 200)}]`).join(' ')
    return `${m.role === 'user' ? 'PERSONNE' : 'CLAUDE'} : ${m.text}${outils ? `\n${outils}` : ''}`
  })
  return lignes.join('\n\n').slice(-150_000)
}

const ouvrirPane = async ($: EngineInterface) => {
  await $.ui.open({ id: PANE, title: 'Handoff' })
}

const generer = async ($: EngineInterface, consignes: string, enAttente: string) => {
  if ((await read($, passation)).enCours) return
  await update($, passation, () => ({ texte: null, fichier: null, enCours: true, erreur: null }))
  void ouvrirPane($)
  $.ui.status('✍ handoff : rédaction du prompt de passation…')
  try {
    const prompt = PROMPT_HANDOFF(enMarkdown(await read($, inventaire)), consignes, enAttente)
    // Le fork relit tout le chat depuis le cache : le moyen le moins cher de tout relire.
    let reply = await $.model.fork({ prompt })
    if (!reply.isAnswered) {
      reply = await $.model.complete({
        model: 'sonnet',
        prompt: `<conversation>\n${await transcriptTexte($)}\n</conversation>\n\n${prompt}`,
        maxTokens: 8000,
      })
    }
    if (!reply.isAnswered || !reply.text.trim()) {
      const raison = reply.isAnswered ? 'réponse vide' : reply.reason
      await update($, passation, p => ({ ...p, enCours: false, erreur: `Rédaction impossible (${raison}).` }))
      return
    }
    const texte = reply.text.trim()
    const home = await $.env.get('HOME')
    const dossier = `${home}/.claude/handoffs`
    const horodatage = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const fichier = `${dossier}/${horodatage}-${(await $.session.id()).slice(0, 8)}.md`
    await $.process.run(['mkdir', '-p', dossier])
    await $.fs.write(fichier, `${texte}\n`)
    await update($, passation, () => ({ texte, fichier, enCours: false, erreur: null }))
    void ouvrirPane($)
  } catch (err) {
    await update($, passation, p => ({ ...p, enCours: false, erreur: `Rédaction interrompue : ${String(err)}` }))
  } finally {
    $.ui.status(undefined)
  }
}

// Le cache est-il froid ? D'après cache-clock s'il tourne, sinon d'après la dernière réponse.
const cacheFroid = async ($: EngineInterface) => {
  const h = (await $.state.get(horlogeCache)).value
  const lastAt = Math.max(h?.lastAt ?? 0, (await read($, suivi)).lastAt ?? 0)
  if (!lastAt) return { froid: false, lastAt }
  const ttlMs = h?.ttlMs ?? ((await $.session.authorize())?.kind === 'bearer' ? 60 * MIN : 5 * MIN)
  return { froid: lastAt + ttlMs < (await $.clock.now()), lastAt }
}

const proposerSeuil = async ($: EngineInterface, tokens: number) => {
  const choix = await $.ui
    .ask(
      `Ce chat atteint ${Math.round(tokens / 1000)} k tokens : au-delà, Claude perd en précision. Préparer un handoff vers un nouveau chat ?`,
      { header: 'Handoff', options: ['Préparer le handoff', 'Plus tard'] },
    )
    .catch(() => 'Plus tard')
  if (choix === 'Préparer le handoff') await generer($, '', '')
}

const nouveauChat = async ($: EngineInterface, texte: string, aRelire: boolean) => {
  await $.ui.close({ id: PANE })
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    $.ui.toast('Impossible de vider ce chat ici : ouvre une nouvelle session, le prompt est dans la zone de saisie.')
    await $.prompt.fill({ text: texte })
    return
  }
  if (aRelire) await $.prompt.fill({ text: texte })
  else await $.prompt.submit({ text: texte })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Rédige un prompt de passation et propose de repartir dans un nouveau chat',
      argumentHint: '[consignes]',
    })
    // Session reprise ou mod rechargé : l'inventaire se reconstruit depuis le transcript.
    if (Object.keys((await read($, inventaire)).outils).length === 0) {
      let inv = await read($, inventaire)
      for (const m of await $.session.messages()) for (const t of m.toolUses) inv = noter(inv, t.tool, t.input, true)
      await update($, inventaire, () => inv)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const creation = e.tool === 'Write' && (ran.result as { type?: string } | undefined)?.type === 'create'
      await update($, inventaire, inv => noter(inv, e.tool, e as unknown as Entree, creation))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId || !e.usage) return next(e)
    const now = await $.clock.now()
    await update($, suivi, s => ({ ...s, lastAt: now }))
    const tokens = (await $.session.usage()).context.tokens ?? 0
    const seuil = Number(await $.store.get('seuil')) || SEUIL_DEFAUT
    if (tokens >= seuil && !(await read($, suivi)).alerteSeuil) {
      await update($, suivi, s => ({ ...s, alerteSeuil: true }))
      // Après la fin du tour, pour ne pas retenir la réponse.
      $.clock.after(1500, () => void proposerSeuil($, tokens))
    }
    return next(e)
  })

  // Retour sur un chat dont le cache a refroidi : proposer de repartir à neuf plutôt que tout relire plein tarif.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || e.turnId || !humain(e.origin)) return next(e)
    const { froid, lastAt } = await cacheFroid($)
    if (!froid || (await read($, suivi)).froidPropose === lastAt) return next(e)
    const tokens = (await $.session.usage()).context.tokens ?? 0
    if (tokens < SEUIL_FROID) return next(e)
    await update($, suivi, s => ({ ...s, froidPropose: lastAt }))
    const choix = await $.ui
      .ask(
        `Le cache de ce chat est froid : ce message relirait ${Math.round(tokens / 1000)} k tokens à plein tarif. Repartir plutôt dans un nouveau chat avec un handoff ?`,
        { header: 'Handoff', options: ['Handoff vers un nouveau chat', 'Envoyer ici quand même'] },
      )
      .catch(() => 'Envoyer ici quand même')
    if (choix !== 'Handoff vers un nouveau chat') return next(e)
    const message = e.text
    $.clock.after(100, () => void generer($, '', message))
    return { drop: 'Handoff en préparation : ton message sera repris à la fin du prompt de passation.' }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const arg = e.args.trim()
    const m = /^seuil\s+(\d+)\s*k?$/i.exec(arg)
    if (m) {
      const seuil = Number(m[1]) * (Number(m[1]) < 2000 ? 1000 : 1)
      await $.store.set('seuil', seuil)
      await update($, suivi, s => ({ ...s, alerteSeuil: false }))
      return { text: `Handoff proposé à partir de ${Math.round(seuil / 1000)} k tokens.` }
    }
    $.clock.after(50, () => void generer($, arg, ''))
    return { text: 'Rédaction du handoff… Il s’affichera dans le panneau Handoff.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const p = await read($, passation)
    if (p.enCours) return <Text dimColor>✍ Rédaction du prompt de passation à partir de tout le chat…</Text>
    if (p.erreur) return <Text color="error">{p.erreur}</Text>
    if (!p.texte) return <Text dimColor>Aucun handoff. Tape /handoff pour en rédiger un.</Text>
    const texte = p.texte
    const fichier = p.fichier ?? ''
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor wrap="truncate-middle">
          {texte.split(/\s+/).length} mots · {fichier}
        </Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button
            key="nouveau"
            variant="primary"
            label="▶ Nouveau chat avec ce prompt"
            onPress={() => nouveauChat($, texte, false)}
          />
          <Button key="relire" label="Nouveau chat, prompt à relire" onPress={() => nouveauChat($, texte, true)} />
          <Button
            key="copier"
            label="Copier"
            onPress={async press => {
              const copie = await $.ui.copy({ text: texte, surface: press.surface })
              $.ui.toast(copie.isCopied ? 'Handoff copié.' : `Copie impossible (${copie.reason}) : il est dans ${fichier}`)
            }}
          />
          <Button key="fermer" role="dismiss" label="Fermer" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Markdown text={texte} />
      </Box>
    )
  })
}
