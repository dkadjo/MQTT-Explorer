/**
 * Tests d'intégration — CsvExportService
 *
 * Simule un arbre MQTT réaliste (ce qu'un vrai broker produirait)
 * et valide le CSV produit de bout en bout.
 *
 * Broker de test utilisé pour la validation manuelle : test.mosquitto.org:1883
 */

import assert from 'assert'
import { TreeNode } from '../../../backend/src/Model/TreeNode'
import { Edge } from '../../../backend/src/Model/Edge'
import { Base64Message } from '../../../backend/src/Model/Base64Message'
import { exportNodeToCsv } from './CsvExportService'

// ─── STUBS BROWSER API ───────────────────────────────────────────────────────

const captures: Array<{ content: string; filename: string }> = []

;(global as any).Blob = class {
  content: string
  constructor(parts: string[]) { this.content = parts.join('') }
}
;(global as any).URL = {
  createObjectURL: (blob: any) => { captures.push({ content: blob.content, filename: '' }); return 'blob:mock' },
  revokeObjectURL: () => {},
}
;(global as any).document = {
  createElement: () => ({
    href: '', download: '',
    click() { captures[captures.length - 1].filename = this.download },
  }),
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function msg(payload: string | null, opts?: { qos?: 0|1|2; retain?: boolean; date?: string }) {
  return {
    payload: payload !== null ? Base64Message.fromString(payload) : null,
    received: new Date(opts?.date ?? '2026-06-23T14:30:00.000Z'),
    qos: (opts?.qos ?? 0) as 0|1|2,
    retain: opts?.retain ?? false,
    length: payload?.length ?? 0,
    messageNumber: 0,
  }
}

function node(name: string, messages: ReturnType<typeof msg>[] = []): TreeNode<any> {
  const n = new TreeNode<any>()
  for (const m of messages) n.setMessage(m as any)
  const e = new Edge<any>(name)
  e.target = n
  n.sourceEdge = e
  return n
}

function attach(parent: TreeNode<any>, child: TreeNode<any>) {
  const edgeName = child.sourceEdge!.name
  const e = new Edge<any>(edgeName)
  e.source = parent
  e.target = child
  child.sourceEdge = e
  parent.addEdge(e)
  return child
}

function lastCsv() { return captures[captures.length - 1]?.content ?? '' }
function lastFilename() { return captures[captures.length - 1]?.filename ?? '' }
function lines(csv: string) { return csv.split('\n') }

// ─── CONSTRUCTION DE L'ARBRE DE TEST ─────────────────────────────────────────
//
// Simule la structure produite par MQTT Explorer après connexion à un broker :
//
// home/
// ├── salon/
// │   ├── temperature  (3 messages)
// │   └── humidity     (2 messages)
// ├── cuisine/
// │   └── temperature  (1 message, retain)
// └── garage/
//     └── door         (2 messages, qos 2)
//
// Cas limites inclus dans l'arbre :
// - payload JSON structuré
// - payload avec virgule
// - payload vide
// - retain + qos variés

function buildRealisticTree() {
  // Construction de bas en haut — les feuilles d'abord,
  // sinon TreeNode.addEdge() appelle removeFromTreeIfEmpty()
  // et retire les noeuds vides sans enfants au moment de l'attachement.

  const salonTemp = node('temperature', [
    msg('{"value":21.3,"unit":"C"}', { date: '2026-06-23T14:30:00.000Z' }),
    msg('{"value":21.5,"unit":"C"}', { date: '2026-06-23T14:31:00.000Z' }),
    msg('{"value":22.0,"unit":"C"}', { date: '2026-06-23T14:32:00.000Z' }),
  ])
  const salonHumidity = node('humidity', [
    msg('58', { date: '2026-06-23T14:30:10.000Z', qos: 1 }),
    msg('60', { date: '2026-06-23T14:31:10.000Z', qos: 1 }),
  ])
  const salon = node('salon', [])
  attach(salon, salonTemp)
  attach(salon, salonHumidity)

  const cuisineTemp = node('temperature', [
    msg('19.5', { date: '2026-06-23T14:30:05.000Z', retain: true }),
  ])
  const cuisine = node('cuisine', [])
  attach(cuisine, cuisineTemp)

  const door = node('door', [
    msg('open',   { date: '2026-06-23T14:28:00.000Z', qos: 2 }),
    msg('closed', { date: '2026-06-23T14:29:00.000Z', qos: 2 }),
  ])
  const garage = node('garage', [])
  attach(garage, door)

  const home = node('home', [])
  attach(home, salon)
  attach(home, cuisine)
  attach(home, garage)

  return { home, salon, salonTemp }
}

// ─── TESTS D'INTÉGRATION ─────────────────────────────────────────────────────

describe('CsvExportService — Intégration', () => {

  describe('Arbre MQTT réaliste — scope recursive', () => {
    let csv: string
    let result: { exported: number }

    before(() => {
      const { home } = buildRealisticTree()
      result = exportNodeToCsv(home, 'recursive')
      csv = lastCsv()
    })

    it('exporte le bon nombre total de messages (8)', () => {
      assert.strictEqual(result.exported, 8)
    })

    it('produit exactement 9 lignes (1 en-tête + 8 messages)', () => {
      assert.strictEqual(lines(csv).length, 9)
    })

    it('la première ligne est l\'en-tête CSV', () => {
      assert.strictEqual(lines(csv)[0], 'topic,payload,timestamp,qos,retain')
    })

    it('les payloads JSON sont présents dans le CSV', () => {
      assert.ok(csv.includes('21.3'), 'valeur 21.3 absente')
      assert.ok(csv.includes('22.0'), 'valeur 22.0 absente')
    })

    it('le flag retain est correct pour cuisine/temperature', () => {
      const line = lines(csv).find(l => l.includes('19.5'))
      assert.ok(line, 'ligne cuisine/temperature introuvable')
      assert.ok(line!.endsWith(',true'), `retain attendu true : ${line}`)
    })

    it('le qos 2 est correct pour garage/door', () => {
      const openLine = lines(csv).find(l => l.includes('open'))
      assert.ok(openLine, 'ligne garage/door open introuvable')
      assert.ok(openLine!.includes(',2,'), `qos attendu 2 : ${openLine}`)
    })

    it('les timestamps sont au format ISO 8601', () => {
      const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/
      const dataLines = lines(csv).slice(1)
      for (const line of dataLines) {
        assert.ok(isoRegex.test(line), `timestamp invalide dans : ${line}`)
      }
    })

    it('le nom du fichier est au bon format', () => {
      const filename = lastFilename()
      assert.ok(filename.startsWith('mqtt_'), `filename: ${filename}`)
      assert.ok(filename.endsWith('.csv'), `filename: ${filename}`)
    })
  })

  describe('Arbre MQTT réaliste — scope node (topic seul)', () => {

    it('scope node sur salon/temperature → 3 messages uniquement', () => {
      const { salonTemp } = buildRealisticTree()
      const result = exportNodeToCsv(salonTemp, 'node')
      assert.strictEqual(result.exported, 3)
    })

    it('scope node sur home → uniquement les messages de home (0 ici)', () => {
      const { home } = buildRealisticTree()
      const result = exportNodeToCsv(home, 'node')
      assert.strictEqual(result.exported, 0)
    })
  })

  describe('Cas limites réalistes', () => {

    it('topic avec payload contenant une virgule → CSV valide parseable', () => {
      const n = node('sensors/label', [msg('Paris, France')])
      exportNodeToCsv(n, 'node')
      const csv = lastCsv()
      const dataLine = lines(csv)[1]
      // Le champ doit être encadré de guillemets
      assert.ok(dataLine.includes('"Paris, France"'), `ligne: ${dataLine}`)
    })

    it('arbre avec nœuds sans messages → pas de lignes vides dans le CSV', () => {
      const root = node('root', [])
      const child = attach(root, node('child', [msg('hello')]))
      exportNodeToCsv(root, 'recursive')
      const csv = lastCsv()
      const dataLines = lines(csv).slice(1)
      for (const line of dataLines) {
        assert.ok(line.trim() !== '', 'ligne vide détectée dans le CSV')
      }
    })

    it('messages avec dates différentes → triés par ordre d\'insertion', () => {
      const n = node('home/temp', [
        msg('21.0', { date: '2026-06-23T14:30:00.000Z' }),
        msg('22.0', { date: '2026-06-23T14:31:00.000Z' }),
        msg('23.0', { date: '2026-06-23T14:32:00.000Z' }),
      ])
      exportNodeToCsv(n, 'node')
      const csv = lastCsv()
      const dataLines = lines(csv).slice(1)
      assert.ok(dataLines[0].includes('14:30'))
      assert.ok(dataLines[1].includes('14:31'))
      assert.ok(dataLines[2].includes('14:32'))
    })
  })
})
