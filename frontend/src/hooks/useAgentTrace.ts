/**
 * The live agent trace of a case.
 *
 * One WebSocket per case. The server replays everything after the last `seq`
 * this hook has seen, then streams new events; a dropped connection simply
 * reconnects from there, so nothing is lost and nothing is shown twice.
 *
 * The token travels as a query parameter because the browser WebSocket API
 * cannot send headers - the same arrangement as the collaborative editor.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentEvent } from '../types'

/** Close codes the server uses for a refusal. Retrying cannot change them. */
const FINAL_CLOSE_CODES = new Set([4401, 4403, 4404])
const REFRESHING_KINDS = new Set(['status', 'message.agent', 'error'])

export interface AgentTrace {
  events:    AgentEvent[]
  connected: boolean
  /** Set when the server refused the socket; the trace will not reconnect. */
  refused:   string | null
}

export function useAgentTrace(caseId: string): AgentTrace {
  const qc = useQueryClient()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const lastSeq = useRef(0)

  useEffect(() => {
    lastSeq.current = 0
    setEvents([])
    setRefused(null)

    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let delay = 1000
    let stopped = false

    const connect = () => {
      const token = localStorage.getItem('remora_token') ?? ''
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const params = new URLSearchParams({
        case_id: caseId, token, after_seq: String(lastSeq.current),
      })
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/agents/ws?${params}`)

      socket.onopen = () => { setConnected(true); delay = 1000 }

      socket.onmessage = (message) => {
        const data = JSON.parse(message.data as string) as
          { type: 'ready' } | { type: 'event'; event: AgentEvent }
        if (data.type !== 'event') return
        const event = data.event
        if (event.seq <= lastSeq.current) return
        lastSeq.current = event.seq
        setEvents(previous => [...previous, event])
        if (REFRESHING_KINDS.has(event.kind)) {
          qc.invalidateQueries({ queryKey: ['agents', caseId] })
          qc.invalidateQueries({ queryKey: ['agent-tasks', caseId] })
        }
      }

      socket.onclose = (close) => {
        setConnected(false)
        if (stopped) return
        if (FINAL_CLOSE_CODES.has(close.code)) {
          setRefused(close.code === 4401 ? 'Session expired' : 'No access to this trace')
          return
        }
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 10000)
      }
    }

    connect()
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [caseId, qc])

  return { events, connected, refused }
}
