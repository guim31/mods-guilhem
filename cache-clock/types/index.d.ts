// lastAt : fin de la dernière requête du fil principal (ou dernière relance) ; null avant la première.
export type Horloge = {
  lastAt: number | null
  ttlMs: number
  tokens: number
  keepUntil: number | null
  pings: number
  prevenu: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { horloge: Horloge }
  }
}
