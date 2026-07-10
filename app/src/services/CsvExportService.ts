import * as q from '../../../backend/src/Model'

export type ExportScope = 'node' | 'recursive'

interface CsvRow {
  topic: string
  payload: string
  timestamp: string
  qos: number
  retain: boolean
}

function collectRows(node: q.TreeNode<any>, scope: ExportScope): CsvRow[] {
  const rows: CsvRow[] = []

  function visit(n: q.TreeNode<any>) {
    const topic = n.path()
    const messages = n.messageHistory.toArray()

    for (const msg of messages) {
      rows.push({
        topic,
        payload: msg.payload ? msg.payload.toUnicodeString() : '',
        timestamp: msg.received.toISOString(),
        qos: msg.qos,
        retain: msg.retain,
      })
    }

    if (scope === 'recursive') {
      for (const edge of n.edgeArray) {
        visit(edge.target)
      }
    }
  }

  visit(node)
  return rows
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowsToCsv(rows: CsvRow[]): string {
  const header = 'topic,payload,timestamp,qos,retain'
  const lines = rows.map(r =>
    [
      escapeCsvField(r.topic),
      escapeCsvField(r.payload),
      escapeCsvField(r.timestamp),
      String(r.qos),
      String(r.retain),
    ].join(',')
  )
  return [header, ...lines].join('\n')
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportNodeToCsv(node: q.TreeNode<any>, scope: ExportScope = 'recursive') {
  const rows = collectRows(node, scope)
  if (rows.length === 0) {
    return { exported: 0 }
  }

  const csv = rowsToCsv(rows)
  const topic = node.path().replace(/\//g, '_') || 'root'
  const date = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
  const filename = `mqtt_${topic}_${date}.csv`

  triggerDownload(csv, filename)
  return { exported: rows.length }
}
