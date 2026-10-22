import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Version } from '../types'
import { diffUnifie } from './diff'

const fichiers = atom({ plugin: 'replay-theater', key: 'fichiers' } as const, {})
const lecture = atom({ plugin: 'replay-theater', key: 'lecture' } as const, { fichier: null, etape: 1, enLecture: false })

const PANE = 'replay'
const OUTILS = ['Edit', 'Write', 'NotebookEdit']
// Au-delà, on ne garde pas les versions (le rejeu d'un fichier énorme n'apprend rien).
const TAILLE_MAX = 500_000
const VERSIONS_MAX = 60
const CADENCE = 2500

let lecteur: Timer | undefined

const lireFichier = async ($: EngineInterface, chemin: string) => {
  try {
    return await $.fs.read(chemin)
  } catch {
    return null
  }
}

const nomDe = (chemin: string) => chemin.split('/').pop() ?? chemin

const ilYA = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `il y a ${Math.round(s / 3600)} h`
}

const arreter = () => {
  lecteur?.cancel()
  lecteur = undefined
}

// Lecture automatique : une étape toutes les 2,5 s jusqu'à la dernière.
const lancer = async ($: EngineInterface) => {
  arreter()
  await update($, lecture, l => ({ ...l, enLecture: true }))
  lecteur = $.clock.every(CADENCE, async () => {
    const l = await read($, lecture)
    const n = ((await read($, fichiers))[l.fichier ?? ''] ?? []).length - 1
    if (!l.enLecture || l.etape >= n) {
      arreter()
      await update($, lecture, x => ({ ...x, enLecture: false }))
      return
    }
    await update($, lecture, x => ({ ...x, etape: x.etape + 1 }))
  })
}

const allerA = async ($: EngineInterface, etape: number) => {
  arreter()
  await update($, lecture, l => ({ ...l, etape, enLecture: false }))
}

const restaurer = async ($: EngineInterface, chemin: string, version: Version, quand: string) => {
  if (version.contenu === null) {
    $.ui.toast('Le fichier n’existait pas à ce moment-là : supprime-le toi-même si c’est ce que tu veux.')
    return
  }
  const choix = await $.ui
    .ask(`Remettre ${nomDe(chemin)} dans son état ${quand} ? La version actuelle reste rejouable.`, {
      header: 'Replay',
      options: ['Restaurer', 'Annuler'],
    })
    .catch(() => 'Annuler')
  if (choix !== 'Restaurer') return
  const contenu = version.contenu
  await $.fs.write(chemin, contenu)
  const at = await $.clock.now()
  await update($, fichiers, f => ({ ...f, [chemin]: [...(f[chemin] ?? []), { at, tool: 'restauration', contenu }] }))
  $.ui.toast(`${nomDe(chemin)} restauré.`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'replay',
      description: 'Rejoue les modifications que Claude a faites à un fichier (le dernier modifié par défaut)',
      argumentHint: '[fichier]',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!OUTILS.includes(e.tool)) return next(e)
    const entree = e as unknown as Record<string, unknown>
    const chemin = String(entree.file_path ?? entree.notebook_path ?? '')
    if (!chemin) return next(e)
    const avant = await lireFichier($, chemin)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const apres = await lireFichier($, chemin)
    if (apres === avant || (apres?.length ?? 0) > TAILLE_MAX || (avant?.length ?? 0) > TAILLE_MAX) return ran
    const at = await $.clock.now()
    await update($, fichiers, f => {
      const versions = [...(f[chemin] ?? [])]
      // Première modification, ou fichier changé entre-temps hors de Claude : on garde l'état de départ.
      if (versions.length === 0 || versions[versions.length - 1]!.contenu !== avant) {
        versions.push({ at, tool: versions.length ? 'hors Claude' : 'origine', contenu: avant })
      }
      versions.push({ at, tool: e.agentId ? `${e.tool} (sous-agent)` : e.tool, contenu: apres })
      return { ...f, [chemin]: versions.slice(-VERSIONS_MAX) }
    })
    return ran
  })

  on('command.run', { command: 'replay' }, async ($, e) => {
    const tous = await read($, fichiers)
    const chemins = Object.keys(tous).sort((a, b) => tous[b]!.at(-1)!.at - tous[a]!.at(-1)!.at)
    if (chemins.length === 0) return { text: 'Aucun fichier modifié par Claude dans ce chat pour l’instant.' }
    const voulu = e.args.trim()
    const chemin = voulu ? chemins.find(c => c.includes(voulu)) : chemins[0]
    if (!chemin) return { text: `Aucun fichier modifié ne correspond à « ${voulu} ».` }
    await update($, lecture, () => ({ fichier: chemin, etape: 1, enLecture: false }))
    const ouvert = await $.ui.open({ id: PANE, title: 'Replay', focus: true })
    await lancer($)
    const n = tous[chemin]!.length - 1
    return {
      text: ouvert.isPlaced
        ? `Rejeu de ${nomDe(chemin)} : ${n} modification${n > 1 ? 's' : ''}.`
        : `Panneau en attente : ${ouvert.reason}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Code } = table
    const tous = await read($, fichiers)
    const l = await read($, lecture)
    const chemin = l.fichier
    const versions = chemin ? tous[chemin] : undefined
    if (!chemin || !versions || versions.length < 2) {
      return <Text dimColor>Rien à rejouer. Tape /replay après que Claude a modifié un fichier.</Text>
    }
    const n = versions.length - 1
    const etape = Math.min(Math.max(1, l.etape), n)
    const avant = versions[etape - 1]!
    const apres = versions[etape]!
    const diff = diffUnifie(avant.contenu, apres.contenu)
    const now = await $.clock.now()
    const autres = Object.keys(tous).filter(c => (tous[c]?.length ?? 0) > 1)

    return (
      <Box flexDirection="column" gap={1}>
        {autres.length > 1 && 'Select' in table && (
          <table.Select
            key="fichier"
            label="Fichier"
            value={chemin}
            options={autres.map(c => ({ value: c, label: nomDe(c) }))}
            onSelect={async valeur => {
              arreter()
              await update($, lecture, () => ({ fichier: valeur, etape: 1, enLecture: false }))
            }}
          />
        )}
        <Text>
          <Text bold>{nomDe(chemin)}</Text> · étape {etape}/{n} · {apres.tool} · {ilYA(now - apres.at)}{' '}
          <Text color="success">+{diff.ajouts}</Text> <Text color="error">−{diff.suppressions}</Text>
        </Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="debut" label="⏮" onPress={() => allerA($, 1)} />
          <Button key="prec" label="◀" onPress={() => allerA($, Math.max(1, etape - 1))} />
          <Button
            key="lecture"
            variant="primary"
            label={l.enLecture ? '⏸ Pause' : '▶ Lecture'}
            onPress={async () => {
              if (l.enLecture) return allerA($, etape)
              if (etape >= n) await update($, lecture, x => ({ ...x, etape: 1 }))
              await lancer($)
            }}
          />
          <Button key="suiv" label="▶|" onPress={() => allerA($, Math.min(n, etape + 1))} />
          <Button key="fin" label="⏭" onPress={() => allerA($, n)} />
          <Button key="avant" label="Restaurer avant cette étape" onPress={() => restaurer($, chemin, avant, 'd’avant cette étape')} />
          <Button key="apres" label="Restaurer après cette étape" onPress={() => restaurer($, chemin, apres, 'd’après cette étape')} />
        </Box>
        {diff.texte ? (
          <Code source={diff.texte} format="diff" path={chemin} />
        ) : (
          <Text dimColor>Aucune différence de texte à cette étape.</Text>
        )}
      </Box>
    )
  })
}
