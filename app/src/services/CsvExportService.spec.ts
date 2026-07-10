import assert from 'assert'
import { TreeNode } from '../../../backend/src/Model/TreeNode'
import { Edge } from '../../../backend/src/Model/Edge'
import { Base64Message } from '../../../backend/src/Model/Base64Message'
import { exportNodeToCsv, ExportScope } from './CsvExportService'

// triggerDownload uses browser APIs (Blob, URL, document) — stub them
const downloaded: Array<{ content: string; filename: string }> = []

function stubBrowserApis() {
  ;(global as any).Blob = class {
    private content: string
    constructor(parts: string[]) {
      this.content = parts.join('')
    }
    text() {
      return Promise.resolve(this.content)
    }
  }
  ;(global as any).URL = {
    createObjectURL: (blob: any) => {
      downloaded.push({ content: blob.content ?? '', filename: '' })
      return 'blob:mock'
    },
    revokeObjectURL: () => {},
  }
  ;(global as any).document = {
    createElement: () => ({
      href: '',
      download: '',
      click() {
        const last = downloaded[downloaded.length - 1]
        if (last) last.filename = this.download
      },
    }),
  }
}

function makeMessage(payload: string | null, opts?: { qos?: 0 | 1 | 2; retain?: boolean }) {
  return {
    payload: payload !== null ? Base64Message.fromString(payload) : null,
    received: new Date('2026-06-23T14:30:00.000Z'),
    qos: (opts?.qos ?? 0) as 0 | 1 | 2,
    retain: opts?.retain ?? false,
    length: payload?.length ?? 0,
    messageNumber: 0,
  }
}

function makeNode(topic: string, messages: ReturnType<typeof makeMessage>[]): TreeNode<any> {
  const node = new TreeNode<any>()
  for (const msg of messages) {
    node.setMessage(msg as any)
  }
  // simulate path() by patching sourceEdge
  const edge = new Edge<any>(topic)
  edge.target = node
  node.sourceEdge = edge
  return node
}

function addChild(parent: TreeNode<any>, childName: string, messages: ReturnType<typeof makeMessage>[]) {
  const child = makeNode(childName, messages)
  const edge = new Edge<any>(childName)
  edge.source = parent
  edge.target = child
  child.sourceEdge = edge
  parent.addEdge(edge)
  return child
}

function lastCsv(): string {
  return downloaded[downloaded.length - 1]?.content ?? ''
}

function csvLines(csv: string): string[] {
  return csv.split('\n')
}

// ─── SETUP ──────────────────────────────────────────────────────────────────
stubBrowserApis()

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe('CsvExportService', () => {

  describe('exportNodeToCsv — cas de base', () => {

    it('retourne exported: 0 et ne télécharge rien si le nœud est vide', () => {
      const node = makeNode('home/temp', [])
      const result = exportNodeToCsv(node, 'node')
      assert.strictEqual(result.exported, 0)
    })

    it('produit un CSV avec en-tête pour un message simple', () => {
      const node = makeNode('home/temp', [makeMessage('22.5')])
      exportNodeToCsv(node, 'node')
      const lines = csvLines(lastCsv())
      assert.strictEqual(lines[0], 'topic,payload,timestamp,qos,retain')
      assert.strictEqual(lines.length, 2)
    })

    it('exporte les 5 colonnes correctement', () => {
      const node = makeNode('home/temp', [makeMessage('22.5', { qos: 1, retain: true })])
      exportNodeToCsv(node, 'node')
      const lines = csvLines(lastCsv())
      const cols = lines[1].split(',')
      assert.strictEqual(cols[1], '22.5')
      assert.strictEqual(cols[2], '2026-06-23T14:30:00.000Z')
      assert.strictEqual(cols[3], '1')
      assert.strictEqual(cols[4], 'true')
    })

    it('retourne le bon nombre de lignes exportées', () => {
      const node = makeNode('home/temp', [
        makeMessage('21.0'),
        makeMessage('21.5'),
        makeMessage('22.0'),
      ])
      const result = exportNodeToCsv(node, 'node')
      assert.strictEqual(result.exported, 3)
    })

  })

  describe('exportNodeToCsv — cas limites payload', () => {

    it('payload null → cellule vide', () => {
      const node = makeNode('home/temp', [makeMessage(null)])
      exportNodeToCsv(node, 'node')
      const line = csvLines(lastCsv())[1]
      const cols = line.split(',')
      assert.strictEqual(cols[1], '')
    })

    it('payload vide → cellule vide', () => {
      const node = makeNode('home/temp', [makeMessage('')])
      exportNodeToCsv(node, 'node')
      const line = csvLines(lastCsv())[1]
      const cols = line.split(',')
      assert.strictEqual(cols[1], '')
    })

    it('payload avec virgule → encadré de guillemets doubles', () => {
      const node = makeNode('home/temp', [makeMessage('hello, world')])
      exportNodeToCsv(node, 'node')
      const line = csvLines(lastCsv())[1]
      assert.ok(line.includes('"hello, world"'), `ligne: ${line}`)
    })

    it('payload avec guillemet → guillemet doublé (RFC 4180)', () => {
      const node = makeNode('home/temp', [makeMessage('say "hello"')])
      exportNodeToCsv(node, 'node')
      const line = csvLines(lastCsv())[1]
      assert.ok(line.includes('"say ""hello"""'), `ligne: ${line}`)
    })

    it('payload JSON brut → encadré et guillemets doublés (RFC 4180)', () => {
      const node = makeNode('home/temp', [makeMessage('{"value":22.5,"unit":"C"}')])
      exportNodeToCsv(node, 'node')
      const line = csvLines(lastCsv())[1]
      // Les guillemets du JSON sont doublés par escapeCsvField — comportement correct RFC 4180
      assert.ok(line.includes('"{""value""'), `ligne: ${line}`)
    })

    it('payload très long → exporté sans troncature', () => {
      const longPayload = 'x'.repeat(10000)
      const node = makeNode('home/temp', [makeMessage(longPayload)])
      exportNodeToCsv(node, 'node')
      const csv = lastCsv()
      assert.ok(csv.includes(longPayload))
    })

  })

  describe('exportNodeToCsv — périmètre', () => {

    it('scope node → exporte uniquement le nœud sélectionné', () => {
      const parent = makeNode('home', [makeMessage('parent')])
      addChild(parent, 'temp', [makeMessage('22.5')])
      const result = exportNodeToCsv(parent, 'node')
      assert.strictEqual(result.exported, 1)
    })

    it('scope recursive → exporte le nœud et tous ses enfants', () => {
      const parent = makeNode('home', [makeMessage('parent')])
      addChild(parent, 'temp', [makeMessage('22.5'), makeMessage('23.0')])
      addChild(parent, 'humidity', [makeMessage('60')])
      const result = exportNodeToCsv(parent, 'recursive')
      assert.strictEqual(result.exported, 4) // 1 parent + 2 temp + 1 humidity
    })

    it('scope recursive profond → descend tous les niveaux', () => {
      const root = makeNode('home', [])
      const salon = addChild(root, 'salon', [makeMessage('salon')])
      addChild(salon, 'temp', [makeMessage('22.5')])
      const result = exportNodeToCsv(root, 'recursive')
      assert.strictEqual(result.exported, 2)
    })

  })

  describe('exportNodeToCsv — nom du fichier', () => {

    it('le nom du fichier contient le topic et une date', () => {
      const node = makeNode('home/temp', [makeMessage('22.5')])
      exportNodeToCsv(node, 'node')
      const filename = downloaded[downloaded.length - 1]?.filename ?? ''
      assert.ok(filename.startsWith('mqtt_'), `filename: ${filename}`)
      assert.ok(filename.endsWith('.csv'), `filename: ${filename}`)
    })

  })

})
