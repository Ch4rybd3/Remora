import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../../api/agents'
import type { AgentTask } from '../../../types'
import { useAgentTrace } from '../../../hooks/useAgentTrace'
import EmptyState from '../../ui/EmptyState'
import { Bot } from '../../../ui/icons'
import AgentList from '../../agents/AgentList'
import AgentChat from '../../agents/AgentChat'
import AgentTracePanel from '../../agents/AgentTracePanel'

/**
 * Charybdis: the agents staffed on this case. Team on the left, conversation
 * with the selected agent in the centre, its live trace on the right.
 * See docs/CHARYBDIS.md.
 */
export default function TeamTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', caseId], queryFn: () => agentsApi.list(caseId),
  })
  const { data: tasks = [] } = useQuery({
    queryKey: ['agent-tasks', caseId], queryFn: () => agentsApi.tasks(caseId),
  })
  const { data: health } = useQuery({
    queryKey: ['agents-llm-health'], queryFn: agentsApi.health, staleTime: 60_000,
  })
  const trace = useAgentTrace(caseId)

  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].id)
  }, [agents, selectedId])

  const fail = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    setError(typeof detail === 'string' ? detail : 'The request failed')
  }

  const add = useMutation({
    mutationFn: () => agentsApi.create(caseId),
    onSuccess: agent => {
      qc.invalidateQueries({ queryKey: ['agents', caseId] })
      setSelectedId(agent.id)
    },
    onError: fail,
  })
  const send = useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) =>
      agentsApi.send(caseId, agentId, content),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['agent-tasks', caseId] }) },
    onError: fail,
  })
  const cancel = useMutation({
    mutationFn: (task: AgentTask) => agentsApi.cancel(caseId, task.agent_id, task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-tasks', caseId] }),
    onError: fail,
  })

  const selected = agents.find(a => a.id === selectedId)
  const agentEvents = useMemo(
    () => trace.events.filter(e => e.agent_id === selectedId),
    [trace.events, selectedId],
  )
  const openTask = tasks.find(t =>
    t.agent_id === selectedId && (t.status === 'pending' || t.status === 'running'))

  if (trace.refused) {
    return <EmptyState icon={Bot} message={trace.refused} />
  }

  return (
    <div className="h-full grid grid-cols-[16rem_minmax(0,1fr)_24rem] 2xl:grid-cols-[16rem_minmax(0,1fr)_32rem]">
      <div className="border-r border-hairline min-h-0">
        <AgentList agents={agents} selectedId={selectedId} onSelect={setSelectedId}
                   onAdd={() => add.mutate()} adding={add.isPending} health={health} />
      </div>

      <div className="min-h-0 flex flex-col">
        {error && (
          <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>
        )}
        <div className="flex-1 min-h-0">
          {selected ? (
            <AgentChat
              agent={selected}
              events={agentEvents}
              openTask={openTask}
              sending={send.isPending}
              onSend={content => send.mutate({ agentId: selected.id, content })}
              onCancel={task => cancel.mutate(task)}
            />
          ) : (
            <EmptyState icon={Bot} message="No agent on this case yet"
                        action={{ label: '+ Add an agent', onClick: () => add.mutate() }} />
          )}
        </div>
      </div>

      <div className="border-l border-hairline min-h-0">
        <AgentTracePanel caseId={caseId} events={selectedId ? agentEvents : trace.events}
                         connected={trace.connected} />
      </div>
    </div>
  )
}
