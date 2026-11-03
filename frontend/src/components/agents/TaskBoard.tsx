import { useState } from 'react'
import type { Agent, AgentTask, AgentTaskStatus } from '../../types'
import { fmtDateTime } from '../../utils/dateUtils'
import { ChevronDown, ChevronRight, Pause, Play } from '../../ui/icons'

const COLUMNS: { id: string; label: string; statuses: AgentTaskStatus[] }[] = [
  { id: 'pending', label: 'Waiting',     statuses: ['pending'] },
  { id: 'running', label: 'In progress', statuses: ['running', 'paused'] },
  { id: 'done',    label: 'Done',        statuses: ['done'] },
  { id: 'failed',  label: 'Stopped',     statuses: ['failed', 'cancelled'] },
]

const KIND_LABEL: Record<string, string> = {
  message:  'message',
  assigned: 'assigned',
  report:   'review',
  help:     'help request',
  review:   'finding review',
  trigger:  'new evidence',
}

interface Controls {
  /** Stop after the current model call, keeping the task's place. */
  onPause?: (task: AgentTask) => void
  /** Hand it back, with what the agent should do differently. */
  onResume?: (task: AgentTask, note: string) => void
}

function TaskCard({ task, agent, onPause, onResume }: { task: AgentTask; agent: Agent | undefined } & Controls) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const body = task.report ?? task.error
  return (
    <div className="border border-hairline bg-panel p-3 space-y-1">
      <div className="flex items-center gap-2 text-label text-fg-muted">
        <span className="text-fg-secondary">{agent?.name ?? 'Agent'}</span>
        <span className="font-mono">{KIND_LABEL[task.kind] ?? task.kind}</span>
        {task.current_step && (task.status === 'running' || task.status === 'paused') && (
          <span className={`font-mono ml-auto ${task.status === 'paused' ? 'text-agent-waiting' : 'text-agent-thinking'}`}>
            {task.status === 'paused' ? `paused at ${task.current_step}` : task.current_step}
          </span>
        )}
      </div>
      <p className="text-ui text-fg whitespace-pre-wrap line-clamp-4">{task.objective}</p>
      <div className="flex items-center gap-2 text-label font-mono text-fg-muted">
        <span>{task.steps_used}/{task.max_steps} calls</span>
        {task.cost_usd > 0 && <span>${task.cost_usd.toFixed(4)}</span>}
        {task.depends_on.length > 0 && <span>waits on {task.depends_on.length}</span>}
        <span className="ml-auto">{fmtDateTime(task.created_at)}</span>
      </div>
      {onPause && (task.status === 'running' || task.status === 'pending') && (
        <button className="btn-ghost text-label flex items-center gap-1" onClick={() => onPause(task)}
                title="Stop after the current model call and take over">
          <Pause size={12} /> Pause
        </button>
      )}
      {onResume && task.status === 'paused' && (
        <div className="flex items-center gap-2">
          <input className="input flex-1 py-1 text-label" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Instructions for the agent (optional)" />
          <button className="btn-secondary text-label flex items-center gap-1"
                  onClick={() => { onResume(task, note); setNote('') }}>
            <Play size={12} /> Resume
          </button>
        </div>
      )}
      {body && (
        <>
          <button className="btn-ghost text-label flex items-center gap-1" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {task.report ? 'Report' : 'Error'}
          </button>
          {open && (
            <p className={`text-ui whitespace-pre-wrap border-l-2 border-hairline pl-2 ${
              task.report ? 'text-fg-secondary' : 'text-agent-error'}`}>{body}</p>
          )}
        </>
      )}
    </div>
  )
}

/** Every task of the case, by state. Reports and help requests show on the leader's cards. */
export default function TaskBoard({ tasks, agents, onPause, onResume }: {
  tasks: AgentTask[]; agents: Agent[]
} & Controls) {
  const byId = Object.fromEntries(agents.map(a => [a.id, a]))
  return (
    <div className="h-full grid grid-cols-4 min-h-0">
      {COLUMNS.map(column => {
        const items = tasks.filter(t => column.statuses.includes(t.status))
        return (
          <div key={column.id} className="flex flex-col min-h-0 border-r border-hairline last:border-r-0">
            <div className="px-3 py-2 border-b border-hairline text-label font-mono uppercase tracking-wider text-fg-muted">
              {column.label} <span className="text-fg-secondary">{items.length}</span>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-2">
              {items.map(task => <TaskCard key={task.id} task={task} agent={byId[task.agent_id]}
                                           onPause={onPause} onResume={onResume} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
