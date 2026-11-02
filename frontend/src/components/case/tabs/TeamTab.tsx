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
import FindingsBoard from '../../agents/FindingsBoard'
import ProposalInbox from '../../agents/ProposalInbox'
import TaskBoard from '../../agents/TaskBoard'

type View = 'chat' | 'tasks' | 'findings' | 'proposals'

/**
 * Charybdis: the agents staffed on this case. Team on the left; in the centre
 * the conversation with the selected agent, the task board, the findings or
 * the proposals waiting for a decision; the live trace on the right. See docs/CHARYBDIS.md.
 */
export default function TeamTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>('chat')
  const [error, setError] = useState<string | null>(null)

  const { data: agents = [] } = useQuery({
    queryKey: ['agents', caseId], queryFn: () => agentsApi.list(caseId),
  })
  const { data: tasks = [] } = useQuery({
    queryKey: ['agent-tasks', caseId], queryFn: () => agentsApi.tasks(caseId),
  })
  const { data: proposals = [] } = useQuery({
    queryKey: ['agent-proposals', caseId], queryFn: () => agentsApi.proposals(caseId),
  })
  const { data: findings = [] } = useQuery({
    queryKey: ['agent-findings', caseId], queryFn: () => agentsApi.findings(caseId),
  })
  const { data: roles = [] } = useQuery({
    queryKey: ['agent-roles'], queryFn: agentsApi.roles, staleTime: Infinity,
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
  const refreshAgents = () => qc.invalidateQueries({ queryKey: ['agents', caseId] })

  const add = useMutation({
    mutationFn: (role: string) => agentsApi.create(caseId, { role }),
    onSuccess: agent => { refreshAgents(); setSelectedId(agent.id); setView('chat') },
    onError: fail,
  })
  const staff = useMutation({
    mutationFn: () => agentsApi.staffTeam(caseId),
    onSuccess: created => {
      refreshAgents()
      const leader = created.find(a => a.role === 'incident-leader')
      if (leader) { setSelectedId(leader.id); setView('chat') }
    },
    onError: fail,
  })
  const send = useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) =>
      agentsApi.send(caseId, agentId, content),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['agent-tasks', caseId] }) },
    onError: fail,
  })
  const autoStart = useMutation({
    mutationFn: ({ agentId, on }: { agentId: string; on: boolean }) =>
      agentsApi.update(caseId, agentId, { auto_start: on }),
    onSuccess: refreshAgents,
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
  // Only an open conversation blocks the chat box; assigned work does not.
  const openMessage = tasks.find(t => t.agent_id === selectedId && t.kind === 'message'
    && (t.status === 'pending' || t.status === 'running'))
  const waiting = proposals.filter(p => p.state === 'proposed').length
  const undecided = findings.filter(f => f.state === 'in_review' || f.state === 'proposed').length
  const active = tasks.filter(t => t.status === 'pending' || t.status === 'running').length

  if (trace.refused) {
    return <EmptyState icon={Bot} message={trace.refused} />
  }

  const views: { id: View; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'tasks', label: `Tasks${active ? ` (${active})` : ''}` },
    { id: 'findings', label: `Findings${undecided ? ` (${undecided})` : ''}` },
    { id: 'proposals', label: `Proposals${waiting ? ` (${waiting})` : ''}` },
  ]

  return (
    <div className="h-full grid grid-cols-[16rem_minmax(0,1fr)_24rem] 2xl:grid-cols-[16rem_minmax(0,1fr)_32rem]">
      <div className="border-r border-hairline min-h-0">
        <AgentList agents={agents} roles={roles} selectedId={selectedId}
                   onSelect={id => { setSelectedId(id); setView('chat') }}
                   onAdd={role => add.mutate(role)} onStaffTeam={() => staff.mutate()}
                   adding={add.isPending || staff.isPending} health={health} />
      </div>

      <div className="min-h-0 flex flex-col">
        <div className="flex items-center gap-1 px-2 border-b border-hairline">
          {views.map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
                    className={view === v.id ? 'tab-active' : 'tab-inactive'}>
              {v.label}
            </button>
          ))}
        </div>
        {error && (
          <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>
        )}
        <div className="flex-1 min-h-0">
          {view === 'tasks' && <TaskBoard tasks={tasks} agents={agents} />}
          {view === 'findings' && <FindingsBoard caseId={caseId} agents={agents} />}
          {view === 'proposals' && <ProposalInbox caseId={caseId} agents={agents} />}
          {view === 'chat' && (selected ? (
            <AgentChat
              agent={selected}
              events={agentEvents}
              openTask={openMessage}
              sending={send.isPending}
              onSend={content => send.mutate({ agentId: selected.id, content })}
              onCancel={task => cancel.mutate(task)}
              onAutoStart={selected.role === 'incident-leader'
                ? on => autoStart.mutate({ agentId: selected.id, on }) : undefined}
            />
          ) : (
            <EmptyState icon={Bot} message="No agent on this case yet"
                        action={{ label: 'Staff the default team', onClick: () => staff.mutate() }} />
          ))}
        </div>
      </div>

      <div className="border-l border-hairline min-h-0">
        <AgentTracePanel caseId={caseId} events={selectedId && view === 'chat' ? agentEvents : trace.events}
                         connected={trace.connected} />
      </div>
    </div>
  )
}
