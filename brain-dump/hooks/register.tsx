import type { EngineInterface, Register } from 'claude-code'

// Réglages gardés d'une session à l'autre ($.store) : /braindump on|off|seuil <mots>.
const SEUIL_DEFAUT = 120
const MODELE = 'sonnet'

// Prompts venus d'une personne : la zone de saisie du terminal, l'app de bureau (SDK), Remote Control.
const HUMAINS = ['composer', 'sdk', 'bridge']
// Un prompt de la personne (une origine absente n'est pas celle d'un mod).
const humain = (origin?: { kind: string }) => !origin || HUMAINS.includes(origin.kind)
// Préfixe pour envoyer un long texte tel quel, sans passer par le mod.
const BRUT = /^\s*(brut|raw)\s*:\s*/i

type Question = { header: string; question: string; options: string[] }
type Analyse = { isDump: boolean; questions: Question[] }

const compterMots = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

// Premier filtre, sans IA : long, peu de mise en forme, pas de code.
const ressembleBrainDump = (text: string, seuil: number) => {
  if (compterMots(text) < seuil || text.includes('```')) return false
  const lignes = text.split('\n').filter(l => l.trim())
  const structurees = lignes.filter(l => /^\s*([-*•#>]|\d+[.)])\s/.test(l)).length
  return structurees / Math.max(1, lignes.length) < 0.3
}

// Le premier objet JSON d'une réponse de modèle, même entouré de texte ou d'une clôture ```json.
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

const PROMPT_ANALYSE = (dump: string) => `Tu reçois un « brain dump » : un texte long, souvent dicté (transcription vocale avec des erreurs), désordonné, qui saute d'une idée à l'autre et se contredit parfois. Une personne veut l'envoyer à Claude Code, un assistant qui agit sur son ordinateur.

1. Décide s'il s'agit vraiment d'un brain dump désordonné (true) ou d'une consigne déjà claire (false).
2. Si true, repère au plus 3 points réellement ambigus ou contradictoires dont la réponse changerait le travail à faire. Pour chacun : une question courte qui finit par « ? », 2 à 4 réponses possibles concrètes (moins de 60 caractères chacune) et un en-tête de 12 caractères au plus. Ne demande rien dont la réponse est déjà dans le texte. Zéro question est une bonne réponse si tout est clair.

Réponds uniquement par un objet JSON :
{"brain_dump": true, "questions": [{"header": "...", "question": "...?", "options": ["...", "..."]}]}
Écris les questions dans la langue du texte.

<brain_dump>
${dump}
</brain_dump>`

const PROMPT_REECRITURE = (dump: string, reponses: string) => `Réécris ce brain dump en un prompt clair pour Claude Code, selon le cadre de prompt recommandé par Anthropic.

- Corrige les erreurs évidentes de transcription vocale, supprime les répétitions et les hésitations.
- Tranche les contradictions avec les réponses de la personne ci-dessous ; à défaut, garde la dernière intention exprimée et signale le doute.
- N'invente rien : chaque exigence doit venir du texte ou des réponses. Garde tous les détails concrets (noms, chemins, chiffres, exemples).
- Écris à la deuxième personne, comme si la personne s'adressait directement à Claude, dans la langue du texte.

Structure exacte, titres en gras :
**Tâche** : ce qu'il faut faire, précisément.
**Contexte et raison** : pourquoi, pour qui, ce qui compte vraiment.
**Garde-fous** : contraintes, ce qu'il ne faut pas faire, ce qu'il faut vérifier avant d'agir.
**Terminé quand** : critères concrets et vérifiables.
Ajoute **Points encore flous** seulement s'il en reste.

Pas de préambule ni de conclusion : renvoie uniquement le prompt.

<brain_dump>
${dump}
</brain_dump>

<reponses_de_la_personne>
${reponses || '(aucune question posée)'}
</reponses_de_la_personne>`

const analyser = async ($: EngineInterface, dump: string): Promise<Analyse | undefined> => {
  const reply = await $.model.complete({ model: MODELE, prompt: PROMPT_ANALYSE(dump), maxTokens: 1200 })
  if (!reply.isAnswered) return undefined
  const lu = lireJson(reply.text) as { brain_dump?: unknown; questions?: unknown } | undefined
  if (!lu) return undefined
  const questions = (Array.isArray(lu.questions) ? lu.questions : [])
    .filter((q): q is Question =>
      typeof q?.question === 'string' && Array.isArray(q?.options) && q.options.length >= 2,
    )
    .slice(0, 3)
    .map(q => ({
      header: String(q.header ?? 'Précision').slice(0, 12),
      question: q.question,
      options: q.options.map(String).map(o => o.slice(0, 80)).slice(0, 4),
    }))
  return { isDump: lu.brain_dump === true, questions }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'braindump',
      description: 'Brain dumps : on | off | seuil <mots> (sans argument : état)',
      argumentHint: '[on|off|seuil N]',
    })
    return next(e)
  })

  on('command.run', { command: 'braindump' }, async ($, e) => {
    const [mot, valeur] = e.args.trim().toLowerCase().split(/\s+/)
    if (mot === 'on' || mot === 'off') await $.store.set('actif', mot === 'on')
    if (mot === 'seuil' && Number(valeur) >= 20) await $.store.set('seuil', Math.round(Number(valeur)))
    const actif = (await $.store.get('actif')) !== false
    const seuil = Number(await $.store.get('seuil')) || SEUIL_DEFAUT
    return {
      text: `Brain dump : **${actif ? 'actif' : 'coupé'}**, à partir de ${seuil} mots. Préfixe \`brut:\` pour envoyer un long texte tel quel.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // Ni commande, ni message caché, ni texte tapé pendant un tour en cours, ni prompt d'un autre mod.
    if (e.command || e.isMeta || e.turnId || !humain(e.origin)) return next(e)
    if (BRUT.test(e.text)) return next({ ...e, text: e.text.replace(BRUT, '') })
    if ((await $.store.get('actif')) === false) return next(e)
    const seuil = Number(await $.store.get('seuil')) || SEUIL_DEFAUT
    if (!ressembleBrainDump(e.text, seuil)) return next(e)

    const dump = e.text
    try {
      $.ui.status('🧠 Brain dump détecté : je prépare quelques questions…')
      const analyse = await analyser($, dump)
      if (!analyse?.isDump) return next(e)

      const reponses: string[] = []
      for (const q of analyse.questions) {
        try {
          const choix = await $.ui.ask(q.question, { header: q.header, options: q.options })
          reponses.push(`- ${q.question} → ${choix}`)
        } catch {
          // Dialogue fermé : on garde les réponses déjà données.
          break
        }
      }

      $.ui.status('🧠 Réécriture en prompt structuré…')
      const reply = await $.model.complete({
        model: MODELE,
        prompt: PROMPT_REECRITURE(dump, reponses.join('\n')),
        maxTokens: 4000,
      })
      if (!reply.isAnswered || !reply.text.trim()) {
        $.ui.toast('Brain dump : réécriture impossible, texte envoyé tel quel.')
        return next(e)
      }
      const structure = reply.text.trim()

      const suite = await $.ui
        .ask('Prompt structuré prêt. Que faire ?', {
          header: 'Brain dump',
          options: ['Envoyer le prompt structuré', 'Le relire avant envoi', 'Envoyer mon texte brut'],
        })
        .catch(() => 'Envoyer le prompt structuré')

      if (suite === 'Envoyer mon texte brut') return next(e)
      if (suite === 'Le relire avant envoi') {
        // Après le refus, la zone de saisie est libre : on y dépose la version structurée.
        await $.clock.after(400, () => void $.prompt.fill({ text: structure }))
        return { drop: 'Prompt structuré placé dans la zone de saisie : relis-le, puis envoie-le.' }
      }

      // Le texte d'origine reste lisible par Claude, à côté, pour ne perdre aucun détail.
      return next({
        ...e,
        text: structure,
        context: [
          ...(e.context ?? []),
          `Brain dump d'origine (dicté ; le prompt ci-dessus en est la version structurée, validée par la personne) :\n\n${dump}`,
        ],
      })
    } finally {
      $.ui.status(undefined)
    }
  })
}
