import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Regle } from '../types'

const enAttente = atom({ plugin: 'reflect', key: 'enAttente' } as const, [])
const retenues = atom({ plugin: 'reflect', key: 'retenues' } as const, [])

const HUMAINS = ['composer', 'sdk', 'bridge']
// Un prompt de la personne (une origine absente n'est pas celle d'un mod).
const humain = (origin?: { kind: string }) => !origin || HUMAINS.includes(origin.kind)

// Premier filtre, sans IA : les tournures d'une consigne qui doit durer.
const INDICES =
  /\b(jamais|toujours|désormais|dorénavant|à l'avenir|à partir de maintenant|la prochaine fois|n'utilise (pas|plus)|ne (\S+ ){0,3}plus|évite|interdit|je préfère|je veux que tu|il faut que tu|retiens|souviens-toi|rappelle-toi|never|always|from now on|going forward|next time|don't ever|do not ever|stop using|i prefer|remember to|make sure to)\b/i

// Un tour du fil principal est-il en cours ? Et une question déjà posée ?
let tourActif = false
let enQuestion = false

const CIBLES = {
  memoire: 'Mémoire auto',
  global: 'CLAUDE.md global',
  projet: 'CLAUDE.md du projet',
  cerveau: 'Second cerveau',
  non: 'Ne pas retenir',
} as const

const lireJson = (text: string): unknown => {
  const debut = text.indexOf('{')
  const fin = text.lastIndexOf('}')
  if (debut < 0 || fin <= debut) return undefined
  try {
    return JSON.parse(text.slice(debut, fin + 1))
  } catch {
    return undefined
  }
}

const PROMPT = (message: string) => `Une personne vient d'écrire ce message à Claude Code, son assistant. Contient-il une RÈGLE DURABLE : une préférence ou une consigne qu'elle voudra voir appliquée aussi dans ses prochaines conversations (style d'écriture, outils, façon de travailler, choses à toujours ou à ne jamais faire) ? Une instruction qui ne vaut que pour la tâche en cours n'en est pas une.

Réponds uniquement par un objet JSON :
{"regle": true, "texte": "la règle en une phrase impérative qui se comprend seule", "application": "quand et comment l'appliquer, en une phrase", "titre": "nom-court-en-kebab-case", "portee": "globale" ou "projet"}
Écris "texte" et "application" dans la langue du message. Si aucune règle durable : {"regle": false}.

<message>
${message}
</message>`

const lire = async ($: EngineInterface, chemin: string) => {
  try {
    return await $.fs.read(chemin)
  } catch {
    return ''
  }
}

const aujourdHui = async ($: EngineInterface) => new Date(await $.clock.now()).toISOString().slice(0, 10)

// Une ligne sous « ## Règles retenues », section créée au besoin.
const ajouterAuMarkdown = async ($: EngineInterface, chemin: string, regle: Regle) => {
  const avant = await lire($, chemin)
  const ligne = `- ${regle.texte}`
  if (avant.includes(ligne)) return
  const titre = '## Règles retenues'
  const apres = avant.includes(titre)
    ? avant.replace(titre, `${titre}\n\n${ligne}`).replace(`${ligne}\n\n-`, `${ligne}\n-`)
    : `${avant.trimEnd()}${avant.trim() ? '\n\n' : ''}${titre}\n\n${ligne}\n`
  await $.fs.write(chemin, apres)
}

// Le format de la mémoire auto de Claude Code : un fichier par fait, et une ligne dans MEMORY.md.
const ajouterALaMemoire = async ($: EngineInterface, regle: Regle) => {
  const home = await $.env.get('HOME')
  const dossier = `${home}/.claude/projects/${(await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')}/memory`
  await $.process.run(['mkdir', '-p', dossier])
  let nom = regle.titre.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'regle'
  while (await $.fs.exists(`${dossier}/${nom}.md`)) nom += '-2'
  const corps = [
    '---',
    `name: ${nom}`,
    `description: ${regle.texte.replace(/\n/g, ' ').slice(0, 150)}`,
    'metadata:',
    '  type: feedback',
    '---',
    '',
    regle.texte,
    '',
    `**Why:** règle donnée explicitement le ${await aujourdHui($)}, retenue avec le mod reflect.`,
    `**How to apply:** ${regle.application}`,
    '',
  ].join('\n')
  await $.fs.write(`${dossier}/${nom}.md`, corps)
  const index = `${dossier}/MEMORY.md`
  const avant = await lire($, index)
  await $.fs.write(index, `${avant.trimEnd()}${avant.trim() ? '\n' : ''}- [${nom}](${nom}.md) — ${regle.texte.slice(0, 90)}\n`)
}

const enregistrer = async ($: EngineInterface, regle: Regle, cible: string) => {
  const home = await $.env.get('HOME')
  if (cible === CIBLES.memoire) await ajouterALaMemoire($, regle)
  else if (cible === CIBLES.global) await ajouterAuMarkdown($, `${home}/.claude/CLAUDE.md`, regle)
  else if (cible === CIBLES.projet) await ajouterAuMarkdown($, `${await $.session.root()}/CLAUDE.md`, regle)
  else if (cible === CIBLES.cerveau) {
    const chemin = String(await $.store.get('cerveau'))
    const avant = await lire($, chemin)
    await $.fs.write(chemin, `${avant.trimEnd()}${avant.trim() ? '\n' : ''}- ${await aujourdHui($)} · ${regle.texte}\n`)
  }
  await update($, retenues, list => [...list, { ...regle, cible }])
  $.ui.toast(`Règle retenue (${cible}).`)
}

const analyser = async ($: EngineInterface, message: string) => {
  const reply = await $.model.complete({ model: 'haiku', prompt: PROMPT(message.slice(0, 6000)), maxTokens: 400 })
  if (!reply.isAnswered) return
  const lu = lireJson(reply.text) as Partial<Regle> & { regle?: unknown }
  if (lu?.regle !== true || typeof lu.texte !== 'string' || !lu.texte.trim()) return
  const regle: Regle = {
    texte: lu.texte.trim(),
    application: String(lu.application ?? 'Dans toutes les conversations concernées.'),
    titre: String(lu.titre ?? 'regle'),
    portee: lu.portee === 'projet' ? 'projet' : 'globale',
  }
  const deja = [...(await read($, retenues)), ...(await read($, enAttente))]
  if (!deja.some(r => r.texte === regle.texte)) await update($, enAttente, list => [...list, regle])
  // Tour déjà fini (réponse rapide) : on demande tout de suite.
  if (!tourActif) $.clock.after(500, () => void proposer($))
}

const proposer = async ($: EngineInterface) => {
  if (enQuestion) return
  enQuestion = true
  try {
    await proposerTout($)
  } finally {
    enQuestion = false
  }
}

const proposerTout = async ($: EngineInterface) => {
  const cerveau = await $.store.get('cerveau')
  for (;;) {
    const [regle] = await read($, enAttente)
    if (!regle) return
    await update($, enAttente, list => list.slice(1))
    const troisieme = typeof cerveau === 'string' && cerveau ? CIBLES.cerveau : CIBLES.projet
    const premiere = regle.portee === 'projet' ? CIBLES.projet : CIBLES.memoire
    const options = [...new Set([premiere, CIBLES.global, troisieme, CIBLES.memoire])].slice(0, 3)
    let choix: string
    try {
      choix = await $.ui.ask(`Règle repérée : « ${regle.texte} » Où la retenir ?`, {
        header: 'Reflect',
        options: [...options, CIBLES.non],
      })
    } catch {
      return
    }
    if (choix !== CIBLES.non) await enregistrer($, regle, choix)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reflect',
      description: 'Règles repérées : liste ; on | off ; « cerveau <fichier.md> » pour ton second cerveau',
      argumentHint: '[on|off|cerveau <fichier>]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && humain(e.origin) && INDICES.test(e.text)) {
      if ((await $.store.get('actif')) !== false) {
        tourActif = true
        const message = e.text
        // En parallèle : le prompt part tout de suite, la question viendra en fin de tour.
        $.clock.after(0, () => void analyser($, message))
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) tourActif = false
    if (!e.agentId && (await read($, enAttente)).length) $.clock.after(800, () => void proposer($))
    return next(e)
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    const [mot, ...reste] = e.args.trim().split(/\s+/)
    if (mot === 'on' || mot === 'off') {
      await $.store.set('actif', mot === 'on')
      return { text: `Reflect ${mot === 'on' ? 'actif' : 'coupé'}.` }
    }
    if (mot === 'cerveau') {
      const chemin = reste.join(' ').replace(/^~/, String(await $.env.get('HOME')))
      if (!chemin) {
        await $.store.delete('cerveau')
        return { text: 'Second cerveau oublié.' }
      }
      await $.store.set('cerveau', chemin)
      return { text: `Second cerveau : ${chemin}. Il sera proposé comme destination des règles.` }
    }
    const faites = await read($, retenues)
    const attente = await read($, enAttente)
    const lignes = [
      faites.length ? `Retenues dans ce chat :\n${faites.map(r => `- ${r.texte} → ${r.cible}`).join('\n')}` : 'Aucune règle retenue dans ce chat.',
      attente.length ? `En attente :\n${attente.map(r => `- ${r.texte}`).join('\n')}` : '',
    ]
    return { text: lignes.filter(Boolean).join('\n\n') }
  })
}
