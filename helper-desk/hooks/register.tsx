import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Agent, Etape, Plan, Statut } from '../types'

const plan = atom({ plugin: 'helper-desk', key: 'plan' } as const, { items: [] })
const agents = atom({ plugin: 'helper-desk', key: 'agents' } as const, [])
const cout = atom({ plugin: 'helper-desk', key: 'cout' } as const, { usd: 0, mainWeight: 0, pastWeight: 0 })
const tick = atom({ plugin: 'helper-desk', key: 'tick' } as const, 0)

const PANE = 'helper-desk'
const VIOLET = '#8b5cf6'
const PALETTE = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#14b8a6', '#a855f7', '#ef4444']
// Clawd, le crabe de Claude Code, en trois lignes.
const CRABE = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']

// Outils qui tiennent la liste des tâches : terminal (TodoWrite, Task*) et app de bureau (update_plan).
const OUTILS_PLAN = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up']

type Entree = Record<string, unknown>

const statut = (s: unknown): Statut => (s === 'completed' || s === 'in_progress' ? s : 'pending')

const majPlan = (avant: Plan, tool: string, input: Entree, result: unknown): Plan => {
  let items: Etape[] = avant.items.map(i => ({ ...i }))
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    items = input.todos.map((t: Entree) => ({
      content: String(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content ?? ''),
      status: statut(t.status),
    }))
  } else if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    items.push({ id, content: String(input.subject ?? ''), status: 'pending' })
  } else if (tool === 'TaskUpdate') {
    const one = items.find(i => i.id === input.taskId)
    if (one && input.status === 'deleted') items = items.filter(i => i !== one)
    else if (one) {
      if (input.status) one.status = statut(input.status)
      if (typeof input.subject === 'string') one.content = input.subject
    }
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
    if (typeof input.start === 'number' && items[input.start - 1]) {
      items.forEach(i => i.status === 'in_progress' && (i.status = 'pending'))
      items[input.start - 1]!.status = 'in_progress'
    }
  } else if (tool === 'mcp__ccd_turn__wrap_up') {
    items.forEach(i => (i.status = 'completed'))
  }
  return { items }
}

// Poids relatif d'une requête : tarifs relatifs d'Anthropic (sortie ×5, écriture de cache ×1,25,
// lecture ×0,1) et gamme du modèle. Sert à répartir le coût réel du chat, pas à le calculer.
const poids = (u: TurnUsage) => {
  const gamme = /haiku/i.test(u.model) ? 1 : /sonnet/i.test(u.model) ? 3 : 5
  return (
    gamme *
    (u.input_tokens + 5 * u.output_tokens + 1.25 * u.cache_creation_input_tokens + 0.1 * u.cache_read_input_tokens)
  )
}

const dollars = (usd: number) => `${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)} $`.replace('.', ',')

const duree = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

const barre = (ratio: number, largeur: number) => {
  const pleins = Math.round(Math.max(0, Math.min(1, ratio)) * largeur)
  return ['█'.repeat(pleins), '░'.repeat(largeur - pleins)] as const
}

// Avancement d'un sous-agent : sa propre liste de tâches s'il en tient une, sinon une estimation.
const avancement = (a: Agent) => {
  if (a.status !== 'running') return { ratio: 1, estime: false }
  if (a.todos && a.todos.total > 0) return { ratio: a.todos.done / a.todos.total, estime: false }
  return { ratio: Math.min(0.9, 1 - Math.exp(-a.tools / 15)), estime: true }
}

const assurerAgent = async ($: EngineInterface, id: string) => {
  const connus = await read($, agents)
  if (connus.some(a => a.id === id)) return
  const info = (await $.agent.list()).find(a => a.id === id)
  const startedAt = await $.clock.now()
  await update($, agents, list =>
    list.some(a => a.id === id)
      ? list
      : [
          ...list,
          {
            id,
            description: info?.description ?? 'sous-agent',
            type: info?.type ?? 'agent',
            color: PALETTE[list.length % PALETTE.length]!,
            startedAt,
            status: 'running' as const,
            tools: 0,
            weight: 0,
          },
        ],
  )
  // Ouvert sans être demandé, le panneau ne se place que sur un écran assez large.
  void $.ui.open({ id: PANE, title: 'Sous-agents' })
}

const resumeOutil = (e: Entree & { tool: string }) => {
  const cible = e.file_path ?? e.command ?? e.pattern ?? e.url ?? e.query ?? e.description
  const nom = e.tool.replace(/^mcp__(.+?)__/, '$1 · ')
  return typeof cible === 'string' ? `${nom} ${cible.split('\n')[0]!.slice(0, 80)}` : nom
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'helper-desk', description: 'Ouvre le panneau des sous-agents (avancement et coût)' })

    // Toutes les 5 s tant qu'un sous-agent tourne : durées à jour, statuts recoupés avec l'engine.
    $.clock.every(5000, async () => {
      const liste = await read($, agents)
      if (!liste.some(a => a.status === 'running')) return
      const vus = await $.agent.list()
      const now = await $.clock.now()
      await update($, agents, list =>
        list.map(a => {
          const s = vus.find(v => v.id === a.id)?.status
          if (a.status !== 'running' || !s || s === 'running' || s === 'pending' || s === 'waiting') return a
          return { ...a, status: s === 'completed' || s === 'idle' ? ('done' as const) : ('failed' as const), endedAt: now }
        }),
      )
      await update($, tick, () => now)
    })
    return next(e)
  })

  on('command.run', { command: 'helper-desk' }, async $ => {
    const ouvert = await $.ui.open({ id: PANE, title: 'Sous-agents' })
    return { text: ouvert.isPlaced ? 'Panneau des sous-agents ouvert.' : `Panneau en attente : ${ouvert.reason}` }
  })

  // Nouveau message de la personne : on range ce qui est fini.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command || e.turnId) return next(e)
    const items = (await read($, plan)).items
    if (items.length && items.every(i => i.status === 'completed')) await update($, plan, () => ({ items: [] }))
    const finis = (await read($, agents)).filter(a => a.status !== 'running')
    if (finis.length) {
      const w = finis.reduce((s, a) => s + a.weight, 0)
      await update($, cout, c => ({ ...c, pastWeight: c.pastWeight + w }))
      await update($, agents, list => list.filter(a => a.status === 'running'))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const entree = e as unknown as Entree & { tool: string }
    if (e.agentId) {
      await assurerAgent($, e.agentId)
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId ? { ...a, tools: a.tools + 1, lastTool: resumeOutil(entree) } : a)),
      )
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    if (OUTILS_PLAN.includes(e.tool) && !e.agentId) {
      await update($, plan, p => majPlan(p, e.tool, entree, ran.result))
    } else if (e.tool === 'TodoWrite' && e.agentId && Array.isArray(entree.todos)) {
      const todos = entree.todos as Entree[]
      const done = todos.filter(t => t.status === 'completed').length
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId ? { ...a, todos: { done, total: todos.length } } : a)),
      )
    }
    return ran
  })

  // Chaque requête au modèle, du fil principal ou d'un sous-agent : son poids dans le coût total.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    try {
      if (response.usage) {
        const w = poids(response.usage)
        if (e.agentId) {
          await assurerAgent($, e.agentId)
          await update($, agents, list => list.map(a => (a.id === e.agentId ? { ...a, weight: a.weight + w } : a)))
        } else {
          await update($, cout, c => ({ ...c, mainWeight: c.mainWeight + w }))
        }
        const usd = (await $.session.usage()).cost?.usd
        if (usd !== undefined) await update($, cout, c => ({ ...c, usd }))
      }
    } catch {
      // Le décompte est un plus : il ne doit jamais gêner la requête.
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const now = await $.clock.now()
      await update($, agents, list =>
        list.map(a =>
          a.id === e.agentId ? { ...a, status: e.isAborted ? ('failed' as const) : ('done' as const), endedAt: now } : a,
        ),
      )
    }
    return next(e)
  })

  // La barre violette au-dessus de la zone de saisie.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { items } = await read($, plan)
    if (e.props.hasSurvey || items.length === 0) return next(e)
    const faits = items.filter(i => i.status === 'completed').length
    if (faits === items.length && !e.props.isWorking) return next(e)
    const courant = items.find(i => i.status === 'in_progress') ?? items.find(i => i.status === 'pending')
    const [plein, vide] = barre(faits / items.length, Math.max(8, Math.min(32, e.props.bodyColumns - 48)))
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={VIOLET}>{plein}</Text>
          <Text color={VIOLET} dimColor>
            {vide}
          </Text>{' '}
          <Text bold>
            {faits}/{items.length}
          </Text>
          {courant ? ` · ${courant.content}` : ' · terminé'}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const liste = await read($, agents)
    const c = await read($, cout)
    const now = Math.max(await read($, tick), ...liste.map(a => a.endedAt ?? a.startedAt))
    const poidsTotal = c.mainWeight + c.pastWeight + liste.reduce((s, a) => s + a.weight, 0)
    const part = (w: number) => (poidsTotal > 0 ? (c.usd * w) / poidsTotal : 0)
    const sousAgents = c.pastWeight + liste.reduce((s, a) => s + a.weight, 0)
    const largeur = Math.max(8, Math.min(24, e.props.bodyColumns - 24))

    return (
      <Box flexDirection="column" gap={1}>
        {liste.length === 0 && <Text dimColor>Aucun sous-agent pour l'instant.</Text>}
        {liste.map(a => {
          const { ratio, estime } = avancement(a)
          const [plein, vide] = barre(ratio, largeur)
          const fini = a.status !== 'running'
          return (
            <Box key={a.id} flexDirection="row" gap={1}>
              <Box flexDirection="column">
                {CRABE.map(ligne => (
                  <Text color={a.color} dimColor={fini}>
                    {ligne}
                  </Text>
                ))}
              </Box>
              <Box flexDirection="column" flexShrink={1}>
                <Text wrap="truncate-end">
                  <Text bold color={a.color}>
                    {a.type}
                  </Text>{' '}
                  {a.description} {a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : ''}
                </Text>
                <Text>
                  <Text color={a.color}>{plein}</Text>
                  <Text dimColor>{vide}</Text> {Math.round(ratio * 100)} %{estime ? ' (estimé)' : ''}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {a.tools} outils · {duree((a.endedAt ?? now) - a.startedAt)} · ≈ {dollars(part(a.weight))}
                  {!fini && a.lastTool ? ` · ${a.lastTool}` : ''}
                </Text>
              </Box>
            </Box>
          )
        })}
        <Text>
          Chat ≈ <Text bold>{dollars(c.usd)}</Text>
          <Text dimColor> · dont sous-agents ≈ {dollars(part(sousAgents))}</Text>
        </Text>
      </Box>
    )
  })
}
