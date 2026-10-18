/**
 * useCollabEditor — TipTap editor wired to a Yjs collaborative session.
 *
 * Creates a Y.Doc, connects to the backend y-websocket endpoint, and returns
 * a configured TipTap editor with collaboration + cursor-presence extensions.
 *
 * The JWT is read from localStorage and passed as a ?token= query parameter
 * because the browser WebSocket API cannot send custom headers.
 *
 * Caller is responsible for reading markdown out of the editor when saving:
 *   editor?.storage.markdown.getMarkdown()
 */

import { useEffect, useMemo, useRef } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import ImageBase from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

import { useAuth } from '../context/AuthContext'
import { color } from '../styles/tokens'

// ── Deterministic presence color from user id (resolved from design tokens) ───

const PRESENCE_TOKEN_NAMES = [
  '--data-1', '--data-2', '--data-3', '--data-4', '--data-5', '--data-6',
  '--accent', '--severity-high',
] as const

function presenceColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0
  return color(PRESENCE_TOKEN_NAMES[Math.abs(h) % PRESENCE_TOKEN_NAMES.length])
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface CollabEditorOptions {
  /** Room identifier — "cp:{cpId}:step:{nodeId}" or "case:{caseId}:quicknotes" */
  roomId:         string
  /** Markdown used to initialise the Y.Doc the first time this room is opened */
  initialContent: string
  placeholder?:   string
  minHeight?:     number
}

export interface CollabEditorResult {
  editor:   Editor | null
  provider: WebsocketProvider | null
}

export function useCollabEditor({
  roomId,
  initialContent,
  placeholder = 'Notes…',
}: CollabEditorOptions): CollabEditorResult {
  const { user } = useAuth()
  const token     = localStorage.getItem('remora_token') ?? ''

  // One Y.Doc per room — recreate only when roomId changes
  const ydoc = useMemo(() => new Y.Doc(), [roomId])

  // WebSocket URL: same host, path /api/v1/collab/ws/{roomId}
  const wsBase = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl  = `${wsBase}://${window.location.host}`

  const provider = useMemo(() => {
    const p = new WebsocketProvider(wsUrl, `collab/ws/${roomId}`, ydoc, {
      params: { token },
    })
    if (user) {
      p.awareness.setLocalStateField('user', {
        name:  user.username,
        color: presenceColor(user.id),
      })
    }
    return p
  }, [roomId, ydoc, token])

  // Track whether we have already seeded the doc
  const seeded = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Collaboration.configure({ document: ydoc }),
      ImageBase.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html:                true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
  })

  // Seed the doc with existing markdown once the provider syncs
  useEffect(() => {
    if (!provider || !editor) return

    const onSync = (synced: boolean) => {
      if (!synced || seeded.current) return
      seeded.current = true
      // If the remote doc has no content, seed from the saved markdown
      if (editor.isEmpty && initialContent.trim()) {
        editor.commands.setContent(initialContent)
      }
    }

    provider.on('sync', onSync)
    return () => { provider.off('sync', onSync) }
  }, [provider, editor, initialContent])

  // Clean up on room change or unmount
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
      seeded.current = false
    }
  }, [provider, ydoc])

  return { editor, provider }
}
