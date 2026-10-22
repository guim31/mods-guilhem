export type Statut = 'pending' | 'in_progress' | 'completed'
export type Etape = { id?: string; content: string; status: Statut }
export type Plan = { items: Etape[] }
export type Agent = {
  id: string
  description: string
  type: string
  color: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'failed'
  tools: number
  lastTool?: string
  weight: number
  todos?: { done: number; total: number }
}
// Coût du chat (registre de l'engine) et poids relatifs servant à le répartir entre les boucles.
export type Cout = { usd: number; mainWeight: number; pastWeight: number }

declare module 'claude-code' {
  interface PluginState {
    'helper-desk': { plan: Plan; agents: Agent[]; cout: Cout; tick: number }
  }
}
