/**
 * Renders a ReactFlow playbook graph onto an HTML5 Canvas and returns it.
 * This avoids the html-to-image / foreignObject SVG limitation in Chrome
 * where nested SVG edges don't render.
 */
import type { Node, Edge } from '@xyflow/react'
import type { LayoutDir } from '../components/playbook/PlaybookNodes'

// ── Palette (mirrors PlaybookNodes.tsx + Tailwind config) ─────────────────────

const C = {
  bg:           '#0B121F',
  bgCard:       '#111827',
  border:       'rgba(255,255,255,0.20)',
  borderSel:    '#2DD4BF',
  green:        '#2DD4BF',
  greenBg:      'rgba(45,212,191,0.10)',
  greenBorder:  'rgba(45,212,191,0.60)',
  red:          '#ef4444',
  redBg:        'rgba(239,68,68,0.10)',
  yellow:       '#FFAF00',
  yellowBg:     'rgba(255,175,0,0.07)',
  yellowBorder: 'rgba(255,175,0,0.40)',
  blue:         '#60a5fa',
  blueBg:       'rgba(96,165,250,0.10)',
  blueBorder:   'rgba(96,165,250,0.40)',
  blueDone:     'rgba(96,165,250,0.60)',
  textBlue:     '#93c5fd',
  edge:         'rgba(255,255,255,0.40)',
  edgeYes:      '#2DD4BF',
  edgeNo:       '#ef4444',
  textPrimary:  'rgba(255,255,255,0.90)',
  textMuted:    'rgba(255,255,255,0.45)',
  textGreen:    'rgba(45,212,191,0.80)',
}

const SCALE  = 2
const PAD    = 48
const RADIUS = 8

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function pill(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
) {
  roundRect(ctx, x, y, w, h, h / 2)
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Smooth bezier curve between two points (ReactFlow smoothstep style). */
function drawEdge(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  dir: LayoutDir,
) {
  const d = dir === 'RIGHT'
    ? Math.abs(x2 - x1) * 0.55
    : Math.abs(y2 - y1) * 0.55

  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth   = 1.5 * SCALE
  ctx.setLineDash([5 * SCALE, 4 * SCALE])
  ctx.moveTo(x1, y1)

  if (dir === 'RIGHT') {
    ctx.bezierCurveTo(x1 + d, y1, x2 - d, y2, x2, y2)
  } else {
    ctx.bezierCurveTo(x1, y1 + d, x2, y2 - d, x2, y2)
  }
  ctx.stroke()
  ctx.setLineDash([])

  // Small arrowhead at endpoint
  const angle = Math.atan2(y2 - (dir === 'RIGHT' ? y2 : y2 - d), x2 - (dir === 'RIGHT' ? x2 - d : x2))
  const aw    = 6 * SCALE
  ctx.beginPath()
  ctx.fillStyle = color
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - aw * Math.cos(angle - 0.4), y2 - aw * Math.sin(angle - 0.4))
  ctx.lineTo(x2 - aw * Math.cos(angle + 0.4), y2 - aw * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
}

// ── Node renderers ────────────────────────────────────────────────────────────

function drawStart(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
) {
  pill(ctx, x, y, w, h)
  ctx.fillStyle   = C.greenBg
  ctx.fill()
  ctx.strokeStyle = C.green
  ctx.lineWidth   = 2 * SCALE
  ctx.stroke()

  ctx.fillStyle  = C.green
  ctx.font       = `bold ${11 * SCALE}px ui-monospace, monospace`
  ctx.textAlign  = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label || 'Start', x + w / 2, y + h / 2)
}

function drawEnd(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
) {
  pill(ctx, x, y, w, h)
  ctx.fillStyle   = C.redBg
  ctx.fill()
  ctx.strokeStyle = C.red
  ctx.lineWidth   = 2 * SCALE
  ctx.stroke()

  ctx.fillStyle  = C.red
  ctx.font       = `bold ${11 * SCALE}px ui-monospace, monospace`
  ctx.textAlign  = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label || 'End', x + w / 2, y + h / 2)
}

function drawStep(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  description: string | undefined,
  done: boolean,
) {
  roundRect(ctx, x, y, w, h, RADIUS * SCALE)
  ctx.fillStyle   = done ? C.greenBg : C.bgCard
  ctx.fill()
  ctx.strokeStyle = done ? C.greenBorder : C.border
  ctx.lineWidth   = 1.5 * SCALE
  ctx.stroke()

  const pad  = 10 * SCALE
  const maxW = w - pad * 2

  ctx.fillStyle    = done ? C.textGreen : C.textPrimary
  ctx.font         = `600 ${11 * SCALE}px ui-sans-serif, sans-serif`
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'

  const lines    = wrapText(ctx, label, maxW)
  const lineH    = 14 * SCALE
  const totalH   = lines.length * lineH + (description && !done ? 4 * SCALE + 10 * SCALE : 0)
  let   curY     = y + (h - totalH) / 2

  lines.forEach(line => {
    ctx.fillText(line, x + pad, curY)
    curY += lineH
  })

  if (description && !done) {
    ctx.fillStyle = C.textMuted
    ctx.font      = `${10 * SCALE}px ui-sans-serif, sans-serif`
    curY += 4 * SCALE
    const descLines = wrapText(ctx, description, maxW)
    descLines.slice(0, 2).forEach(line => {
      ctx.fillText(line, x + pad, curY)
      curY += 13 * SCALE
    })
  }

  if (done) {
    ctx.fillStyle = C.green
    ctx.font      = `bold ${10 * SCALE}px ui-sans-serif, sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText('✓', x + w - 6 * SCALE, y + 6 * SCALE)
  }
}

function drawRemediation(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  description: string | undefined,
  done: boolean,
) {
  roundRect(ctx, x, y, w, h, RADIUS * SCALE)
  ctx.fillStyle   = done ? C.blueBg : C.bgCard
  ctx.fill()
  ctx.strokeStyle = done ? C.blueDone : C.blueBorder
  ctx.lineWidth   = 1.5 * SCALE
  ctx.stroke()

  const pad  = 10 * SCALE
  const iconW = 14 * SCALE
  const maxW = w - pad - iconW - pad

  // Shield icon hint (small "R" tag in top-left)
  ctx.fillStyle    = done ? C.blue : 'rgba(96,165,250,0.50)'
  ctx.font         = `bold ${8 * SCALE}px ui-monospace, monospace`
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('REM', x + pad, y + 5 * SCALE)

  ctx.fillStyle    = done ? 'rgba(96,165,250,0.80)' : C.textBlue
  ctx.font         = `600 ${11 * SCALE}px ui-sans-serif, sans-serif`
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'

  const lines    = wrapText(ctx, label, maxW)
  const lineH    = 14 * SCALE
  const totalH   = lines.length * lineH + (description && !done ? 4 * SCALE + 10 * SCALE : 0)
  let   curY     = y + (h - totalH) / 2

  lines.forEach(line => {
    ctx.fillText(line, x + pad, curY)
    curY += lineH
  })

  if (description && !done) {
    ctx.fillStyle = C.textMuted
    ctx.font      = `${10 * SCALE}px ui-sans-serif, sans-serif`
    curY += 4 * SCALE
    const descLines = wrapText(ctx, description, maxW)
    descLines.slice(0, 2).forEach(line => {
      ctx.fillText(line, x + pad, curY)
      curY += 13 * SCALE
    })
  }

  if (done) {
    ctx.fillStyle = C.blue
    ctx.font      = `bold ${10 * SCALE}px ui-sans-serif, sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText('✓', x + w - 6 * SCALE, y + 6 * SCALE)
  }
}

function drawDecision(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  done: boolean,
) {
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.beginPath()
  ctx.moveTo(cx, y)
  ctx.lineTo(x + w, cy)
  ctx.lineTo(cx, y + h)
  ctx.lineTo(x, cy)
  ctx.closePath()
  ctx.fillStyle   = done ? C.greenBg : C.yellowBg
  ctx.fill()
  ctx.strokeStyle = done ? C.green : C.yellowBorder
  ctx.lineWidth   = 1.5 * SCALE
  ctx.stroke()

  ctx.fillStyle    = done ? C.green : C.yellow
  ctx.font         = `600 ${10 * SCALE}px ui-sans-serif, sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  const lines    = wrapText(ctx, label, w * 0.55)
  const lineH    = 13 * SCALE
  let   startY   = cy - ((lines.length - 1) * lineH) / 2
  lines.forEach(line => {
    ctx.fillText(line, cx, startY)
    startY += lineH
  })

  if (done) {
    ctx.fillText('✓', cx + w * 0.3, y + h * 0.2)
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  color: string | undefined,
) {
  const c = color ?? '#3b82f6'
  // Parse hex → rgba fill
  const r = parseInt(c.slice(1, 3), 16)
  const g = parseInt(c.slice(3, 5), 16)
  const b = parseInt(c.slice(5, 7), 16)

  roundRect(ctx, x, y, w, h, 12 * SCALE)
  ctx.fillStyle   = `rgba(${r},${g},${b},0.09)`
  ctx.fill()
  ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`
  ctx.lineWidth   = 1.5 * SCALE
  ctx.stroke()

  ctx.fillStyle    = `rgba(${r},${g},${b},0.80)`
  ctx.font         = `bold ${11 * SCALE}px ui-sans-serif, sans-serif`
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + 14 * SCALE, y + 10 * SCALE)
}

// ── Handle position helpers ───────────────────────────────────────────────────

function sourcePoint(
  n: Node,
  ox: number, oy: number,
  handleId: string | null | undefined,
  dir: LayoutDir,
): [number, number] {
  const w = (n.measured?.width  ?? 200) * SCALE
  const h = (n.measured?.height ?? 60)  * SCALE
  const x = ox + n.position.x * SCALE
  const y = oy + n.position.y * SCALE

  if (n.type === 'decision') {
    if (dir === 'RIGHT') {
      // yes → right vertex, no → bottom vertex
      return handleId === 'no'
        ? [x + w / 2, y + h]
        : [x + w,     y + h / 2]
    } else {
      // yes → bottom vertex, no → right vertex
      return handleId === 'no'
        ? [x + w,     y + h / 2]
        : [x + w / 2, y + h]
    }
  }

  return dir === 'RIGHT'
    ? [x + w, y + h / 2]
    : [x + w / 2, y + h]
}

function targetPoint(
  n: Node,
  ox: number, oy: number,
  dir: LayoutDir,
): [number, number] {
  const w = (n.measured?.width  ?? 200) * SCALE
  const h = (n.measured?.height ?? 60)  * SCALE
  const x = ox + n.position.x * SCALE
  const y = oy + n.position.y * SCALE

  if (n.type === 'decision') {
    return dir === 'RIGHT'
      ? [x,         y + h / 2]
      : [x + w / 2, y]
  }

  return dir === 'RIGHT'
    ? [x,         y + h / 2]
    : [x + w / 2, y]
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderPlaybookToCanvas(
  nodes: Node[],
  edges: Edge[],
  dir: LayoutDir = 'DOWN',
): HTMLCanvasElement {
  if (nodes.length === 0) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c
  }

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  nodes.forEach(n => {
    const w = n.measured?.width  ?? 200
    const h = n.measured?.height ?? 60
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  })

  const W  = (maxX - minX + PAD * 2) * SCALE
  const H  = (maxY - minY + PAD * 2) * SCALE
  const ox = (PAD - minX) * SCALE
  const oy = (PAD - minY) * SCALE

  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(W)
  canvas.height = Math.round(H)
  const ctx = canvas.getContext('2d')!

  // Background
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // ── Edges ────────────────────────────────────────────────────────────────
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  edges.forEach(edge => {
    const src = nodeMap.get(edge.source)
    const tgt = nodeMap.get(edge.target)
    if (!src || !tgt) return

    const [sx, sy] = sourcePoint(src, ox, oy, edge.sourceHandle, dir)
    const [tx, ty] = targetPoint(tgt, ox, oy, dir)

    // Yes edges green, no edges red, others white
    const color = edge.sourceHandle === 'yes'
      ? C.edgeYes
      : edge.sourceHandle === 'no'
        ? C.edgeNo
        : C.edge

    drawEdge(ctx, sx, sy, tx, ty, color, dir)
  })

  // ── Nodes (frames first so they render behind other nodes) ───────────────
  const sortedNodes = [
    ...nodes.filter(n => n.type === 'frame'),
    ...nodes.filter(n => n.type !== 'frame'),
  ]

  sortedNodes.forEach(n => {
    // Frame nodes use explicit style dimensions; others use measured dimensions
    const isFrame = n.type === 'frame'
    const s = (n.style ?? {}) as Record<string, unknown>
    const w = (isFrame
      ? (typeof s.width  === 'number' ? s.width  : n.measured?.width  ?? 200)
      : (n.measured?.width  ?? 200)) * SCALE
    const h = (isFrame
      ? (typeof s.height === 'number' ? s.height : n.measured?.height ?? 60)
      : (n.measured?.height ?? 60)) * SCALE
    const x    = ox + n.position.x * SCALE
    const y    = oy + n.position.y * SCALE
    const d    = n.data as Record<string, unknown>
    const lbl  = String(d.label  ?? '')
    const desc = d.description as string | undefined
    const done = !!d.done

    switch (n.type) {
      case 'frame':       drawFrame(ctx, x, y, w, h, lbl, d.color as string | undefined); break
      case 'start':       drawStart(ctx, x, y, w, h, lbl); break
      case 'end':         drawEnd(ctx, x, y, w, h, lbl); break
      case 'step':        drawStep(ctx, x, y, w, h, lbl, desc, done); break
      case 'decision':    drawDecision(ctx, x, y, w, h, lbl, done); break
      case 'remediation': drawRemediation(ctx, x, y, w, h, lbl, desc, done); break
    }
  })

  return canvas
}
