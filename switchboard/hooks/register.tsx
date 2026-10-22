import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ligne, Vu } from '../types'

const vus = atom({ plugin: 'switchboard', key: 'vus' } as const, [])
const lignes = atom({ plugin: 'switchboard', key: 'lignes' } as const, [])
const reglages = atom({ plugin: 'switchboard', key: 'reglages' } as const, { refuses: [], masques: [], enAttente: false })

const PANE = 'switchboard'
const MOI = 'switchboard'

type Installe = { installPath?: string; version?: string }

const lireJson = async ($: EngineInterface, chemin: string): Promise<Record<string, unknown> | undefined> => {
  try {
    return JSON.parse(await $.fs.read(chemin)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// Ce que fait un mod, d'après ce que son module écoute et appelle.
const traits = (vu: Vu | undefined) => {
  if (!vu) return 'chargé avant switchboard : détails au prochain démarrage'
  const t: string[] = []
  if (vu.calls.some(c => c.startsWith('model.'))) t.push('IA (consomme ton forfait)')
  if (vu.calls.includes('ui.open')) t.push('panneau')
  if (vu.events.some(e => e.startsWith('ui.render'))) t.push('affichage')
  if (vu.calls.includes('command.register')) t.push('commandes')
  if (vu.events.some(e => e.startsWith('prompt.'))) t.push('prompts')
  if (vu.events.some(e => e.startsWith('tool.'))) t.push('outils')
  if (vu.calls.includes('ui.status')) t.push('ligne d’état')
  return t.join(' · ') || 'hooks'
}

// Plugins installés (et leur état dans enabledPlugins), plus les mods chargés depuis un dossier.
const recenser = async ($: EngineInterface) => {
  const home = await $.env.get('HOME')
  const actifs = ((await $.settings.read({ key: 'enabledPlugins' })) ?? {}) as Record<string, boolean>
  const installes = ((await lireJson($, `${home}/.claude/plugins/installed_plugins.json`))?.plugins ?? {}) as Record<
    string,
    Installe[]
  >
  const { refuses } = await read($, reglages)
  const out: Ligne[] = []
  for (const cle of new Set([...Object.keys(installes), ...Object.keys(actifs)])) {
    const [name = cle, source = ''] = cle.split('@')
    const chemin = installes[cle]?.[0]?.installPath
    let estMod = false
    if (chemin) {
      try {
        estMod = (await $.fs.read(`${chemin}/hooks/hooks.json`)).includes('"modules"')
      } catch {
        estMod = false
      }
    }
    out.push({ cle, name, source, actif: actifs[cle] !== false, installe: true, estMod })
  }
  for (const vu of await read($, vus)) {
    if (out.some(l => l.name === vu.name) || vu.provenance.endsWith('@builtin')) continue
    out.push({
      cle: vu.provenance,
      name: vu.name,
      source: vu.provenance.endsWith('@inline') ? 'dossier' : vu.provenance.split('@')[1] ?? '',
      actif: !refuses.includes(vu.name),
      installe: false,
      estMod: true,
    })
  }
  out.sort((a, b) => Number(b.estMod) - Number(a.estMod) || a.name.localeCompare(b.name))
  await update($, lignes, () => out)
}

const basculer = async ($: EngineInterface, ligne: Ligne) => {
  if (ligne.installe) {
    // Plugins installés : la même clé enabledPlugins que /plugin, dans les réglages utilisateur.
    const chemin = `${await $.env.get('HOME')}/.claude/settings.json`
    const reglagesUtilisateur = await lireJson($, chemin)
    if (!reglagesUtilisateur) {
      $.ui.toast('switchboard : ~/.claude/settings.json illisible, rien n’a été changé.')
      return
    }
    const enabled = { ...((reglagesUtilisateur.enabledPlugins as Record<string, boolean> | undefined) ?? {}) }
    enabled[ligne.cle] = !ligne.actif
    await $.fs.write(chemin, `${JSON.stringify({ ...reglagesUtilisateur, enabledPlugins: enabled }, null, 2)}\n`)
  } else {
    // Mods chargés depuis un dossier : refusés au prochain chargement.
    const r = await read($, reglages)
    const refuses = ligne.actif ? [...r.refuses, ligne.name] : r.refuses.filter(n => n !== ligne.name)
    await $.store.set('refuses', refuses)
    await update($, reglages, x => ({ ...x, refuses }))
  }
  await update($, reglages, x => ({ ...x, enAttente: true }))
  await update($, lignes, list => list.map(l => (l.cle === ligne.cle ? { ...l, actif: !l.actif } : l)))
}

const masquer = async ($: EngineInterface, nom: string) => {
  const r = await read($, reglages)
  const masques = r.masques.includes(nom) ? r.masques.filter(n => n !== nom) : [...r.masques, nom]
  await $.store.set('masques', masques)
  await update($, reglages, x => ({ ...x, masques }))
  if (masques.includes(nom)) $.ui.toast(`Panneaux de ${nom} masqués : ferme celui qui est ouvert, il ne se rouvrira plus.`)
}

const recharger = async ($: EngineInterface) => {
  try {
    await $.command.run({ command: 'reload-plugins', args: '' })
    await update($, reglages, x => ({ ...x, enAttente: false }))
  } catch {
    $.ui.toast('Rechargement impossible ici : les changements prendront effet à la prochaine session.')
  }
}

export const register: Register = on => {
  // Chaque module de hooks qui se charge après celui-ci passe par ici : on le note, et on refuse ceux qu'on a coupés.
  on('plugin.register', async ($, e, next) => {
    const vu: Vu = {
      name: e.name,
      provenance: e.provenance,
      tier: e.tier,
      events: [...e.uses.events],
      calls: [...e.uses.calls],
    }
    await update($, vus, list => [...list.filter(v => v.name !== e.name), vu])
    const refuses = ((await $.store.get('refuses')) as string[] | undefined) ?? []
    if (e.name !== MOI && refuses.includes(e.name)) return { refuse: 'coupé avec /mods (switchboard)' }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Switchboard : voir, couper ou rallumer chaque mod, masquer leurs panneaux' })
    const refuses = ((await $.store.get('refuses')) as string[] | undefined) ?? []
    const masques = ((await $.store.get('masques')) as string[] | undefined) ?? []
    await update($, reglages, x => ({ ...x, refuses, masques }))
    return next(e)
  })

  // Panneaux masqués : leur ouverture répond « non placé » au lieu d'ouvrir.
  on('ui.open', async ($, e, next) => {
    const { masques } = await read($, reglages)
    if (next.origin.plugin !== MOI && masques.includes(next.origin.plugin)) {
      return { value: { isPlaced: false as const, reason: 'panneau masqué avec /mods (switchboard)' } }
    }
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await recenser($)
    const ouvert = await $.ui.open({ id: PANE, title: 'Mods', focus: true })
    const toutes = await read($, lignes)
    const mods = toutes.filter(l => l.estMod)
    return {
      text: ouvert.isPlaced
        ? `${mods.filter(l => l.actif).length} mods actifs sur ${mods.length}.`
        : `Panneau en attente : ${ouvert.reason}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const toutes = await read($, lignes)
    const vusParNom = new Map((await read($, vus)).map(v => [v.name, v]))
    const r = await read($, reglages)
    const mods = toutes.filter(l => l.estMod)
    const autres = toutes.filter(l => !l.estMod)

    const rangee = (l: Ligne) => {
      const vu = vusParNom.get(l.name)
      const aPanneau = vu?.calls.includes('ui.open') ?? false
      const masque = r.masques.includes(l.name)
      return (
        <Box key={l.cle} flexDirection="row" gap={1}>
          <Text color={l.actif ? 'success' : undefined} dimColor={!l.actif}>
            {l.actif ? '●' : '○'}
          </Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold={l.actif} dimColor={!l.actif} wrap="truncate-end">
              {l.name} <Text dimColor>{l.source}</Text>
            </Text>
            {l.estMod && (
              <Text dimColor wrap="truncate-end">
                {traits(vu)}
                {masque ? ' · panneaux masqués' : ''}
              </Text>
            )}
          </Box>
          {l.name !== MOI && (
            <Button key={`bascule:${l.cle}`} label={l.actif ? 'Couper' : 'Rallumer'} onPress={() => basculer($, l)} />
          )}
          {aPanneau && l.name !== MOI && (
            <Button
              key={`panneau:${l.cle}`}
              label={masque ? 'Montrer panneaux' : 'Masquer panneaux'}
              onPress={() => masquer($, l.name)}
            />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text bold>{mods.filter(l => l.actif).length}</Text> mods actifs sur {mods.length}
          {autres.length ? <Text dimColor> · {autres.length} autres plugins</Text> : ''}
        </Text>
        {r.enAttente && (
          <Box flexDirection="row" gap={1}>
            <Text color="warning">Changements en attente.</Text>
            <Button key="recharger" variant="primary" label="Recharger les mods" onPress={() => recharger($)} />
          </Box>
        )}
        <Box flexDirection="column">{mods.map(rangee)}</Box>
        {autres.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Plugins sans hooks (skills, commandes, MCP) :</Text>
            {autres.map(rangee)}
          </Box>
        )}
      </Box>
    )
  })
}
