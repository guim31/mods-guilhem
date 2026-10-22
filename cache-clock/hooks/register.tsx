import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Horloge } from '../types'

const horloge = atom({ plugin: 'cache-clock', key: 'horloge' } as const, {
  lastAt: null,
  ttlMs: 60 * 60_000,
  tokens: 0,
  keepUntil: null,
  pings: 0,
  prevenu: false,
})

const MIN = 60_000
const HEURE = 60 * MIN
const MAINTIEN_MAX = 2 * HEURE
const HUMAINS = ['composer', 'sdk', 'bridge']
// Un prompt de la personne (une origine absente n'est pas celle d'un mod).
const humain = (origin?: { kind: string }) => !origin || HUMAINS.includes(origin.kind)
const PING =
  'Message technique envoyé par le mod cache-clock pour garder le cache de ce chat au chaud : réponds seulement « ok », sans rien faire d’autre.'

// Abonnement Claude (jeton « bearer ») : cache d'une heure ; clé d'API ou fournisseur tiers : 5 minutes.
const ttlAuto = async ($: EngineInterface) => ((await $.session.authorize())?.kind === 'bearer' ? HEURE : 5 * MIN)

const ttlChoisi = async ($: EngineInterface) => {
  const choix = await $.store.get('ttl')
  return choix === '5m' ? 5 * MIN : choix === '1h' ? HEURE : ttlAuto($)
}

// Relancer un peu avant l'échéance : 3 min sur un cache d'une heure, 45 s sur 5 min.
const marge = (ttlMs: number) => (ttlMs >= HEURE ? 3 * MIN : 45_000)

const enClair = (ms: number) => {
  const m = Math.round(Math.abs(ms) / MIN)
  if (m < 1) return 'moins d’une minute'
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`
}

const milliers = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} k` : String(n))

// Relecture à froid (écriture de cache ×1,25 ou ×2) contre lecture à chaud (×0,1).
const surcout = (ttlMs: number) => (ttlMs >= HEURE ? 20 : 12)

const sessionDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

// Une seule relance à la fois.
let pingEnCours = false

const ping = async ($: EngineInterface) => {
  if (pingEnCours) return
  pingEnCours = true
  try {
    const r = await $.model.fork({ prompt: PING })
    const now = await $.clock.now()
    if (r.isAnswered) {
      await update($, horloge, h => ({ ...h, lastAt: now, pings: h.pings + 1 }))
      if (r.usage.cache_read_input_tokens < 1000) {
        $.ui.toast('cache-clock : le cache était déjà froid, relu une fois plein tarif ; il est de nouveau chaud.')
      }
    } else if (r.reason === 'nothing-to-fork') {
      await update($, horloge, h => ({ ...h, keepUntil: null }))
    }
  } finally {
    pingEnCours = false
  }
}

const tourner = async ($: EngineInterface) => {
  const h = await read($, horloge)
  if (h.lastAt === null) return $.ui.status(undefined)
  const now = await $.clock.now()
  const reste = h.lastAt + h.ttlMs - now
  let maintien = h.keepUntil !== null && h.keepUntil > now

  if (h.keepUntil !== null && !maintien) {
    await update($, horloge, x => ({ ...x, keepUntil: null }))
    $.ui.toast('cache-clock : fin du maintien au chaud (2 h écoulées).')
    maintien = false
  }
  // On ne relance qu'un cache encore chaud : réchauffer un cache froid coûte autant qu'un message.
  if (maintien && reste > 0 && reste < marge(h.ttlMs)) void ping($)

  if (maintien) {
    $.ui.status(
      `♨ cache maintenu au chaud encore ${enClair(h.keepUntil! - now)}` +
        (h.pings ? ` · ${h.pings} relance${h.pings > 1 ? 's' : ''}` : ''),
    )
  } else if (reste > 0) {
    $.ui.status(`♨ cache chaud · froid dans ${enClair(reste)}${reste < 5 * MIN ? ' · /keepwarm pour le garder' : ''}`)
    if (reste < 5 * MIN && !h.prevenu && h.tokens > 20_000) {
      await update($, horloge, x => ({ ...x, prevenu: true }))
      $.ui.toast(`Le cache de ce chat refroidit dans ${enClair(reste)}. /keepwarm pour le garder chaud.`, {
        timeoutMs: 10_000,
      })
    }
  } else {
    $.ui.status(
      `🧊 cache froid depuis ${enClair(reste)} · prochain message : ${milliers(h.tokens)} tokens relus plein tarif (≈ ×${surcout(h.ttlMs)})`,
    )
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'keepwarm',
      description: 'Garde le cache du chat chaud jusqu’à ton prochain message (2 h max) ; « off » pour arrêter',
      argumentHint: '[off|30m|1h|2h]',
      immediate: true,
    })
    await $.command.register({
      name: 'cacheclock',
      description: 'État du cache du chat ; durée de vie : auto | 5m | 1h',
      argumentHint: '[auto|5m|1h]',
      immediate: true,
    })

    const ttlMs = await ttlChoisi($)
    await update($, horloge, h => ({ ...h, ttlMs }))

    // Session reprise : la dernière écriture du transcript situe la dernière requête.
    if ((await read($, horloge)).lastAt === null) {
      try {
        const home = await $.env.get('HOME')
        const id = await $.session.id()
        const stat = await $.fs.stat(`${home}/.claude/projects/${sessionDir(e.cwd)}/${id}.jsonl`)
        const now = await $.clock.now()
        if (stat.mtimeMs < now - 30_000) await update($, horloge, h => ({ ...h, lastAt: stat.mtimeMs }))
      } catch {
        // Nouvelle session : rien à reprendre.
      }
    }

    $.clock.every(15_000, () => void tourner($))
    void tourner($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage) {
      const now = await $.clock.now()
      const u = e.usage
      await update($, horloge, h => ({
        ...h,
        lastAt: now,
        prevenu: false,
        tokens: Math.max(h.tokens, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens),
      }))
      // La taille exacte du contexte, telle que la ligne d'état la donne.
      const tokens = (await $.session.usage()).context.tokens
      if (tokens) await update($, horloge, h => ({ ...h, tokens }))
      void tourner($)
    }
    return next(e)
  })

  // Le maintien s'arrête dès que la personne envoie son message suivant.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && humain(e.origin) && (await read($, horloge)).keepUntil !== null) {
      await update($, horloge, h => ({ ...h, keepUntil: null }))
    }
    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'stop') {
      await update($, horloge, h => ({ ...h, keepUntil: null }))
      void tourner($)
      return { text: 'Maintien au chaud arrêté.' }
    }
    const m = /^(\d+)\s*(m|min|h)?$/.exec(arg)
    const demande = m ? Number(m[1]) * (m[2] === 'h' ? HEURE : MIN) : MAINTIEN_MAX
    const duree = Math.min(MAINTIEN_MAX, Math.max(5 * MIN, demande))
    const now = await $.clock.now()
    const h = await read($, horloge)
    await update($, horloge, x => ({ ...x, keepUntil: now + duree, pings: 0 }))
    void tourner($)
    const froid = h.lastAt !== null && h.lastAt + h.ttlMs <= now
    return {
      text: froid
        ? `Le cache est déjà froid : le maintien (${enClair(duree)}) reprendra après la prochaine réponse.`
        : `Cache maintenu au chaud pendant ${enClair(duree)} au plus : une relance discrète juste avant chaque échéance, jusqu’à ton prochain message.`,
    }
  })

  on('command.run', { command: 'cacheclock' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (['auto', '5m', '1h'].includes(arg)) {
      await $.store.set('ttl', arg)
      const ttlMs = await ttlChoisi($)
      await update($, horloge, h => ({ ...h, ttlMs }))
    }
    const h: Horloge = await read($, horloge)
    const now = await $.clock.now()
    const etat =
      h.lastAt === null
        ? 'pas encore de requête dans ce chat'
        : h.lastAt + h.ttlMs > now
          ? `chaud, froid dans ${enClair(h.lastAt + h.ttlMs - now)}`
          : `froid depuis ${enClair(h.lastAt + h.ttlMs - now)}`
    void tourner($)
    return {
      text: `Cache : ${etat}. Durée de vie : ${h.ttlMs >= HEURE ? '1 h' : '5 min'} (${String((await $.store.get('ttl')) ?? 'auto')}). Contexte : ${milliers(h.tokens)} tokens.`,
    }
  })
}
