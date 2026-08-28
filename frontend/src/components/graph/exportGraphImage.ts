import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react'
import { toPng } from 'html-to-image'

import { color } from '../../styles/tokens'

/**
 * Export a canvas as a PNG of what is actually on screen.
 *
 * The previous exporters redrew the graph: one traced every node shape onto a
 * 2D canvas, the other rebuilt it server-side with matplotlib. Both were
 * reimplementations of the React components, so both drifted — different node
 * shapes, different edge routing, different alignment. An analyst recognised
 * the graph but not the picture.
 *
 * This rasterises the real DOM instead. Nodes keep their CSS, edges keep the
 * waypoints the analyst dragged, frames keep their colour, and the theme is
 * whatever is active. There is nothing to keep in sync because there is no
 * second drawing of anything.
 *
 * The viewport is re-fitted to the nodes' bounding box first, so the export is
 * the whole graph rather than the part that happens to be scrolled into view.
 */
/** The canvas as a PNG data URL, or null when there is nothing to draw. */
export async function renderGraphPng(
  nodes: Node[],
  { padding = 0.1, maxSize = 4096, scale = 2 } = {},
): Promise<string | null> {
  if (nodes.length === 0) return null

  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewportEl) return null

  const bounds = getNodesBounds(nodes)
  // Cap the output so a sprawling graph cannot ask the browser for a canvas it
  // will refuse to allocate.
  const width  = Math.min(maxSize, Math.round(bounds.width  * (1 + padding * 2)))
  const height = Math.min(maxSize, Math.round(bounds.height * (1 + padding * 2)))

  const viewport = getViewportForBounds(bounds, width, height, 0.2, 4, padding)

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: color('--surface-canvas'),
    width,
    height,
    pixelRatio: scale,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
    // Controls, the minimap and the resize handles are chrome for editing, not
    // part of the graph.
    filter: (node) => {
      const cls = (node as HTMLElement).classList
      if (!cls) return true
      return !(
        cls.contains('react-flow__controls') ||
        cls.contains('react-flow__minimap') ||
        cls.contains('react-flow__resize-control') ||
        cls.contains('react-flow__panel')
      )
    },
  })

  return dataUrl
}

/** Render and download in one step. */
export async function exportGraphPng(nodes: Node[], filename: string): Promise<void> {
  const dataUrl = await renderGraphPng(nodes)
  if (!dataUrl) return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`
  link.click()
}

/** Render as a Blob, for uploading alongside the graph. */
export async function renderGraphBlob(nodes: Node[]): Promise<Blob | null> {
  const dataUrl = await renderGraphPng(nodes)
  if (!dataUrl) return null
  return (await fetch(dataUrl)).blob()
}
