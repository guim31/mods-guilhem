import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

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

const objectifDe = (texte: string) => {
  const ligne = texte.split('\n').find(l => l.trim()) ?? ''
  return ligne.length > 160 ? `${ligne.slice(0, 157)}…` : ligne
}

const nomDe = (chemin: string) => chemin.split('/').pop() ?? chemin
const dossierDe = (chemin: string) => chemin.slice(0, Math.max(0, chemin.length - nomDe(chemin).length - 1))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'inventaire', description: 'Ouvre le panneau « Dans ce chat »' })

    // Session reprise ou mod rechargé : on relit le transcript.
    const inv = await read($, inventaire)
    if (inv.objectif === null && Object.keys(inv.outils).length === 0) {
      let refait = inv
      for (const m of await $.session.messages()) {
        if (m.role === 'user' && refait.objectif === null && m.text.trim() && !m.toolResults?.length) {
          refait = { ...refait, objectif: objectifDe(m.text) }
        }
        for (const t of m.toolUses) refait = noter(refait, t.tool, t.input, t.result, !t.agentId)
      }
      await update($, inventaire, () => refait)
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
    const { Box, Text } = $.ui.resolve(e)
    const inv = await read($, inventaire)

    const section = (titre: string, lignes: ReturnType<typeof Text>[], vide?: string) =>
      lignes.length || vide ? (
        <Box key={titre} flexDirection="column">
          <Text bold>{titre}</Text>
          {lignes.length ? lignes : <Text dimColor>{vide}</Text>}
        </Box>
      ) : null

    const reste = (n: number) => (n > MAX_LIGNES ? [<Text dimColor>  + {n - MAX_LIGNES} autres</Text>] : [])

    const fichiers = (marque: string, liste: string[]) =>
      liste.slice(-MAX_LIGNES).map(f => (
        <Text wrap="truncate-start">
          {'  '}
          {marque} {nomDe(f)} <Text dimColor>{dossierDe(f)}</Text>
        </Text>
      ))

    const comptes = (table: Record<string, number>) =>
      Object.entries(table)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_LIGNES)
        .map(([nom, n]) => (
          <Text wrap="truncate-end">
            {'  '}
            {nom} <Text dimColor>×{n}</Text>
          </Text>
        ))

    const faites = inv.taches.filter(t => t.status === 'completed').length
    const taches = inv.taches.map(t => (
      <Text wrap="truncate-end" dimColor={t.status === 'completed'}>
        {'  '}
        {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} {t.content}
      </Text>
    ))
    const nbFichiers = inv.crees.length + inv.modifies.length + inv.lus.length

    return (
      <Box flexDirection="column" gap={1}>
        {section('🎯 Objectif', inv.objectif ? [<Text>  {inv.objectif}</Text>] : [], 'pas encore de message')}
        {section(`☑ Tâches${inv.taches.length ? ` (${faites}/${inv.taches.length})` : ''}`, taches)}
        {section('🔌 Connecteurs', [...comptes(inv.connecteurs), ...reste(Object.keys(inv.connecteurs).length)])}
        {section('🧩 Skills', comptes(inv.skills))}
        {section(`📄 Fichiers${nbFichiers ? ` (${nbFichiers})` : ''}`, [
          ...fichiers('✚', inv.crees),
          ...fichiers('✎', inv.modifies),
          ...fichiers('👁', inv.lus),
          ...reste(Math.max(inv.crees.length, inv.modifies.length, inv.lus.length)),
        ])}
        {section(
          '🔗 Liens',
          inv.liens.slice(-MAX_LIGNES).map(l => (
            <Text wrap="truncate-end">
              {'  '}
              {l}
            </Text>
          )),
        )}
        {section('🛠 Outils', comptes(inv.outils), 'aucun appel pour l’instant')}
      </Box>
    )
  })
}
