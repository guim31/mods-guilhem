import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Etape, Inventaire, Statut } from '../types'

const inventaire = atom({ plugin: 'chat-inventory', key: 'inventaire' } as const, {
  objectif: null,
  taches: [],
  connecteurs: {},
  skills: {},
  outils: {},
  lus: [],
  crees: [],
  modifies: [],
  liens: [],
})

const PANE = 'chat-inventory'
const HUMAINS = ['composer', 'sdk', 'bridge']
// Un prompt de la personne (une origine absente n'est pas celle d'un mod).
const humain = (origin?: { kind: string }) => !origin || HUMAINS.includes(origin.kind)
const MAX_LIGNES = 8

// Une teinte par carte, lisible sur fond clair comme sur fond sombre.
const TEINTES = {
  objectif: '#d97757',
  taches: '#8b5cf6',
  connecteurs: '#3b82f6',
  skills: '#10b981',
  fichiers: '#f59e0b',
  liens: '#06b6d4',
  outils: '#ec4899',
} as const
const CREE = '#22c55e'
const MODIFIE = '#f97316'
const LU = '#60a5fa'

// Le dossier personnel, abrégé en ~ dans les chemins affichés.
let maison = ''

type Entree = Record<string, unknown>

// Un « logo » par connecteur, reconnu au nom du serveur ou de ses outils.
const LOGOS: [RegExp, string][] = [
  [/gmail|_draft|search_threads|label_(message|thread)/i, '✉️ Gmail'],
  [/calendar|_event\b|_events\b|suggest_time/i, '📅 Agenda'],
  [/sheets|spreadsheet|_values\b/i, '📊 Sheets'],
  [/slides|presentation|slide_page/i, '📽️ Slides'],
  [/read_doc|update_doc/i, '📄 Docs'],
  [/drive|file_content|recent_files|copy_file|share_file|trash_file/i, '📁 Drive'],
  [/slack/i, '💬 Slack'],
  [/notion/i, '📓 Notion'],
  [/github/i, '🐙 GitHub'],
  [/linear/i, '📐 Linear'],
  [/figma/i, '🎨 Figma'],
  [/hubspot/i, '🧲 HubSpot'],
  [/shopify/i, '🛍️ Shopify'],
  [/browser|chrome/i, '🌐 Navigateur'],
  [/blender/i, '🧊 Blender'],
  [/article|citation|pubmed/i, '🔬 PubMed'],
  [/generate_(video|image|audio)|katana|higgsfield/i, '🎬 Higgsfield'],
  [/__ads_/i, '📣 Meta Ads'],
  [/terminal/i, '⌨️ Terminal'],
  [/visualize|show_widget/i, '📈 Visualisation'],
  [/scheduled/i, '⏰ Tâches planifiées'],
]

// Les outils du harnais de l'app (liste des tâches, fin de tour) ne sont pas des connecteurs.
const HARNAIS = /^mcp__ccd_/

const connecteur = (tool: string) => {
  const trouve = LOGOS.find(([motif]) => motif.test(tool))
  if (trouve) return trouve[1]
  const serveur = tool.replace(/^mcp__/, '').split('__')[0] ?? tool
  return `🔌 ${serveur.length > 20 ? `${serveur.slice(0, 8)}…` : serveur}`
}

const ajouter = (liste: string[], x: unknown) =>
  typeof x === 'string' && x && !liste.includes(x) ? [...liste, x].slice(-200) : liste

const compter = (table: Record<string, number>, cle: string) => ({ ...table, [cle]: (table[cle] ?? 0) + 1 })

const statut = (s: unknown): Statut => (s === 'completed' || s === 'in_progress' ? s : 'pending')

const majTaches = (avant: Etape[], tool: string, input: Entree, result: unknown): Etape[] => {
  let items = avant.map(i => ({ ...i }))
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    items = input.todos.map((t: Entree) => ({ content: String(t.content ?? ''), status: statut(t.status) }))
  } else if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    items.push({ id, content: String(input.subject ?? ''), status: 'pending' })
  } else if (tool === 'TaskUpdate') {
    const one = items.find(i => i.id === input.taskId)
    if (one && input.status === 'deleted') items = items.filter(i => i !== one)
    else if (one && input.status) one.status = statut(input.status)
  } else if (tool === 'mcp__ccd_turn__update_plan') {
    if (Array.isArray(input.items)) {
      items = input.items.map((t: Entree) => ({ content: String(t.content ?? ''), status: statut(t.status) }))
    }
    if (Array.isArray(input.done)) {
      for (const n of input.done) if (items[Number(n) - 1]) items[Number(n) - 1]!.status = 'completed'
    }
    if (input.advance === true) {
      const courant = items.find(i => i.status === 'in_progress')
      if (courant) courant.status = 'completed'
      const suivant = items.find(i => i.status === 'pending')
      if (suivant) suivant.status = 'in_progress'
    }
    if (typeof input.start === 'number' && items[input.start - 1]) items[input.start - 1]!.status = 'in_progress'
  } else if (tool === 'mcp__ccd_turn__wrap_up') {
    items.forEach(i => (i.status = 'completed'))
  }
  return items
}

const noter = (inv: Inventaire, tool: string, input: Entree, result: unknown, principal: boolean): Inventaire => {
  const out = { ...inv }
  if (principal) out.taches = majTaches(inv.taches, tool, input, result)
  if (tool.startsWith('mcp__') && !HARNAIS.test(tool)) out.connecteurs = compter(inv.connecteurs, connecteur(tool))
  else if (!HARNAIS.test(tool)) out.outils = compter(inv.outils, tool)
  if (tool === 'Skill' && typeof input.skill === 'string') out.skills = compter(inv.skills, input.skill)
  if (tool === 'Read') out.lus = ajouter(inv.lus, input.file_path)
  if (tool === 'Write') {
    const cree = (result as { type?: string } | undefined)?.type === 'create'
    if (cree) out.crees = ajouter(inv.crees, input.file_path)
    else out.modifies = ajouter(inv.modifies, input.file_path)
  }
  if (tool === 'Edit' || tool === 'NotebookEdit') out.modifies = ajouter(inv.modifies, input.file_path ?? input.notebook_path)
  if (tool === 'WebFetch' || /navigate$/.test(tool)) out.liens = ajouter(inv.liens, input.url)
  return out
}

// La phrase qui dit le but : après un « Tâche : » s'il y en a un, sinon la première ligne qui n'annonce pas une suite.
const objectifDe = (texte: string) => {
  const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean)
  const i = lignes.findIndex(l => /^(task|tâche|tache|objectif|goal|but)\s*:/i.test(l))
  const brute =
    i >= 0
      ? lignes[i]!.replace(/^[^:]+:\s*/, '') || lignes[i + 1] || ''
      : (lignes.find(l => !l.endsWith(':')) ?? lignes[0] ?? '')
  const ligne = brute.replace(/^[#>*\-\s]+/, '')
  return ligne.length > 220 ? `${ligne.slice(0, 217)}…` : ligne
}

const nomDe = (chemin: string) => chemin.split('/').pop() ?? chemin
const dossierDe = (chemin: string) => chemin.slice(0, Math.max(0, chemin.length - nomDe(chemin).length - 1))
const court = (chemin: string) => (maison && chemin.startsWith(maison) ? `~${chemin.slice(maison.length)}` : chemin)
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

// Un lien affiché par son hôte et le début de son chemin.
const lienCourt = (url: string) => {
  const m = /^[a-z]+:\/\/([^/?#]+)([^?#]*)/i.exec(url)
  if (!m) return url
  const chemin = m[2] && m[2] !== '/' ? m[2] : ''
  return `${m[1]}${chemin.length > 40 ? `${chemin.slice(0, 39)}…` : chemin}`
}

// L'anneau d'avancement des tâches ; un point pulse au bout de l'arc tant qu'une tâche est en cours.
const anneau = (faites: number, total: number, enCours: boolean) => {
  const t = TEINTES.taches
  const r = 24
  const tour = 2 * Math.PI * r
  const ratio = total ? faites / total : 0
  const angle = 2 * Math.PI * ratio - Math.PI / 2
  const x = (30 + r * Math.cos(angle)).toFixed(1)
  const y = (30 + r * Math.sin(angle)).toFixed(1)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">',
    `<circle cx="30" cy="30" r="${r}" fill="none" stroke="${t}" stroke-opacity="0.18" stroke-width="6"/>`,
    ratio > 0
      ? `<circle cx="30" cy="30" r="${r}" fill="none" stroke="${t}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(tour * ratio).toFixed(1)} ${tour.toFixed(1)}" transform="rotate(-90 30 30)"/>`
      : '',
    enCours
      ? `<circle cx="${x}" cy="${y}" r="4" fill="${t}"><animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite"/></circle>`
      : '',
    `<text x="30" y="35" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="${t}">${faites}/${total}</text>`,
    '</svg>',
  ].join('')
}

const POINT = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="3" fill="${TEINTES.taches}"><animate attributeName="r" values="2.5;5.5;2.5" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite"/></circle></svg>`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'inventaire', description: 'Ouvre le panneau « Dans ce chat »' })
    maison = (await $.env.get('HOME')) ?? ''

    // Session reprise ou mod rechargé : on relit le transcript.
    const messages = await $.session.messages()
    const inv = await read($, inventaire)
    if (inv.objectif === null && Object.keys(inv.outils).length === 0) {
      let refait = inv
      for (const m of messages) {
        if (m.role === 'user' && refait.objectif === null && m.text.trim() && !m.toolResults?.length) {
          refait = { ...refait, objectif: objectifDe(m.text) }
        }
        for (const t of m.toolUses) refait = noter(refait, t.tool, t.input, t.result, !t.agentId)
      }
      await update($, inventaire, () => refait)
    } else {
      // L'objectif se relit au premier message, pour suivre la règle d'extraction du moment.
      const premier = messages.find(m => m.role === 'user' && m.text.trim() && !m.toolResults?.length)
      if (premier) await update($, inventaire, x => ({ ...x, objectif: objectifDe(premier.text) }))
    }
    // Ouvert sans être demandé, il ne se place que sur un écran assez large.
    void $.ui.open({ id: PANE, title: 'Dans ce chat' })
    return next(e)
  })

  on('command.run', { command: 'inventaire' }, async $ => {
    const ouvert = await $.ui.open({ id: PANE, title: 'Dans ce chat' })
    return { text: ouvert.isPlaced ? 'Panneau « Dans ce chat » ouvert.' : `Panneau en attente : ${ouvert.reason}` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && humain(e.origin) && (await read($, inventaire)).objectif === null) {
      const objectif = objectifDe(e.text)
      await update($, inventaire, inv => ({ ...inv, objectif }))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      await update($, inventaire, inv => noter(inv, e.tool, e as unknown as Entree, ran.result, !e.agentId))
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Link } = table
    const inv = await read($, inventaire)
    // Le bureau a des fonds, des survols et des dessins vectoriels ; le terminal garde les cadres et les couleurs.
    const bureau = e.surface !== 'terminal'
    const fond = (teinte: string, alpha: string) => (bureau ? { backgroundColor: `${teinte}${alpha}` } : {})
    const survol = (teinte: string) => (bureau ? { hover: { backgroundColor: `${teinte}1a` } } : {})
    const dessin = (source: string, alt: string, taille: number) =>
      'Svg' in table ? <table.Svg source={source} alt={alt} width={taille} height={taille} isInteractive /> : null

    const carte = (cle: string, titre: string, teinte: string, compte: string, corps: RenderChildren) => (
      <Box key={cle} flexDirection="column" borderStyle="round" borderColor={teinte} paddingX={1} {...survol(teinte)}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text color={teinte} bold>
            {titre}
          </Text>
          <Text color={teinte} bold>
            {compte}
          </Text>
        </Box>
        {corps}
      </Box>
    )

    const reste = (n: number) =>
      n > MAX_LIGNES ? (
        <Text dimColor>
          + {n - MAX_LIGNES} autres
        </Text>
      ) : null

    const puces = (prefixe: string, compte: Record<string, number>, teinte: string) => (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {Object.entries(compte)
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_LIGNES * 2)
          .map(([nom, n]) => (
            <Box key={`${prefixe}:${nom}`} borderStyle="round" borderColor={teinte} paddingX={1} {...fond(teinte, '1f')}>
              <Text wrap="truncate-end">
                {nom}{' '}
                <Text color={teinte} bold>
                  ×{n}
                </Text>
              </Text>
            </Box>
          ))}
      </Box>
    )

    // Tâches : l'anneau et l'étape en cours, puis la liste.
    const total = inv.taches.length
    const faites = inv.taches.filter(t => t.status === 'completed').length
    const iCourante = inv.taches.findIndex(t => t.status === 'in_progress')
    const courante = inv.taches[iCourante]
    const ligneTache = (t: Etape, i: number) => {
      const encours = t.status === 'in_progress'
      const fait = t.status === 'completed'
      return (
        <Box key={`tache:${i}`} flexDirection="row" gap={1} alignItems="center" {...(encours ? fond(TEINTES.taches, '24') : {})}>
          {encours && bureau && 'Svg' in table ? (
            dessin(POINT, 'en cours', 14)
          ) : (
            <Text color={fait ? CREE : encours ? TEINTES.taches : 'subtle'} bold>
              {fait ? '✓' : encours ? '▸' : '○'}
            </Text>
          )}
          <Text wrap="truncate-end" dimColor={fait} bold={encours}>
            {t.content}
          </Text>
        </Box>
      )
    }
    const crans = 12
    const pleins = total ? Math.round((faites / total) * crans) : 0
    const enTete = (
      <Box flexDirection="row" gap={1} alignItems="center">
        {bureau && 'Svg' in table ? (
          dessin(anneau(faites, total, Boolean(courante)), `${faites} tâches faites sur ${total}`, 60)
        ) : (
          <Text>
            <Text color={TEINTES.taches}>{'▰'.repeat(pleins)}</Text>
            <Text dimColor>{'▱'.repeat(crans - pleins)}</Text>
          </Text>
        )}
        <Box flexDirection="column" flexShrink={1}>
          <Text bold wrap="truncate-end">
            {courante ? courante.content : faites === total ? 'Tout est fait' : 'En attente'}
          </Text>
          <Text dimColor>
            {courante ? `étape ${iCourante + 1} sur ${total}` : `${faites} sur ${total} faites`}
          </Text>
        </Box>
      </Box>
    )

    // Fichiers : trois familles, chacune sa marque et sa couleur.
    const ligneFichier = (marque: string, teinte: string, chemin: string) => (
      <Box key={`${marque}:${chemin}`} flexDirection="row" gap={1} {...survol(teinte)}>
        <Text color={teinte} bold>
          {marque}
        </Text>
        <Box flexDirection="column" flexShrink={1}>
          <Text wrap="truncate-end">
            {nomDe(chemin)}
          </Text>
          <Text dimColor wrap="truncate-middle">
            {court(dossierDe(chemin))}
          </Text>
        </Box>
      </Box>
    )
    const familles: [string, string, string, string[]][] = [
      ['✚', CREE, 'créé', inv.crees],
      ['✎', MODIFIE, 'modifié', inv.modifies],
      ['◉', LU, 'lu', inv.lus],
    ]
    const nbFichiers = inv.crees.length + inv.modifies.length + inv.lus.length

    // Outils : une barre par outil, à l'échelle du plus appelé.
    const outils = Object.entries(inv.outils).sort((a, b) => b[1] - a[1])
    const plusHaut = Math.max(1, ...outils.map(([, n]) => n))
    const largeur = Math.max(6, Math.min(22, e.props.bodyColumns - 26))
    const appels = outils.reduce((s, [, n]) => s + n, 0)

    return (
      <Box flexDirection="column" gap={1}>
        {carte(
          'objectif',
          '🎯 Objectif',
          TEINTES.objectif,
          '',
          inv.objectif ? (
            <Text>{inv.objectif}</Text>
          ) : (
            <Text dimColor>pas encore de message</Text>
          ),
        )}
        {total > 0 &&
          carte('taches', '☑ Tâches', TEINTES.taches, `${faites}/${total}`, [
            enTete,
            <Box key="liste" flexDirection="column">
              {inv.taches.map(ligneTache)}
            </Box>,
          ])}
        {Object.keys(inv.connecteurs).length > 0 &&
          carte(
            'connecteurs',
            '🔌 Connecteurs',
            TEINTES.connecteurs,
            String(Object.values(inv.connecteurs).reduce((s, n) => s + n, 0)),
            puces('connecteur', inv.connecteurs, TEINTES.connecteurs),
          )}
        {Object.keys(inv.skills).length > 0 &&
          carte('skills', '🧩 Skills', TEINTES.skills, String(Object.keys(inv.skills).length), puces('skill', inv.skills, TEINTES.skills))}
        {nbFichiers > 0 &&
          carte('fichiers', '📄 Fichiers', TEINTES.fichiers, String(nbFichiers), [
            <Box key="familles" flexDirection="row" flexWrap="wrap" gap={1}>
              {familles
                .filter(([, , , liste]) => liste.length)
                .map(([marque, teinte, mot, liste]) => (
                  <Box key={`compte:${mot}`} paddingX={1} {...fond(teinte, '29')}>
                    <Text color={teinte} bold>
                      {marque} {pluriel(liste.length, mot)}
                    </Text>
                  </Box>
                ))}
            </Box>,
            ...familles.flatMap(([marque, teinte, , liste]) => [
              ...liste.slice(-MAX_LIGNES).map(f => ligneFichier(marque, teinte, f)),
              reste(liste.length),
            ]),
          ])}
        {inv.liens.length > 0 &&
          carte('liens', '🔗 Liens', TEINTES.liens, String(inv.liens.length), [
            ...inv.liens.slice(-MAX_LIGNES).map(l => (
              <Box key={`lien:${l}`} flexDirection="row" gap={1} {...survol(TEINTES.liens)}>
                <Text color={TEINTES.liens}>↗</Text>
                <Link href={l} label={lienCourt(l)} />
              </Box>
            )),
            reste(inv.liens.length),
          ])}
        {carte(
          'outils',
          '🛠 Outils',
          TEINTES.outils,
          appels ? pluriel(appels, 'appel') : '',
          outils.length ? (
            outils.slice(0, MAX_LIGNES).map(([nom, n]) => (
              <Box key={`outil:${nom}`} flexDirection="row" gap={1}>
                <Box width={15} flexShrink={0}>
                  <Text wrap="truncate-end">{nom}</Text>
                </Box>
                <Text color={TEINTES.outils}>{'█'.repeat(Math.max(1, Math.round((n / plusHaut) * largeur)))}</Text>
                <Text dimColor>
                  {n}
                </Text>
              </Box>
            ))
          ) : (
            <Text dimColor>aucun appel pour l’instant</Text>
          ),
        )}
      </Box>
    )
  })
}
