import { useQuickNote } from '../../../hooks/useQuickNote'
import MarkdownEditor from '../../ui/MarkdownEditor'
import type { Case } from '../../../types'

interface Props { case_: Case }

export default function NotesTab({ case_ }: Props) {
  const { value, dirty, saved, isPending, handleChange, doSave, onFocus, onBlur } =
    useQuickNote(case_.id)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hairline bg-panel/40 shrink-0 flex items-center gap-3">
        <h3 className="text-accent font-semibold text-label uppercase tracking-wide">
          Quick Notes
        </h3>
        <span className="text-label text-fg-secondary/30 flex-1">
          Scratchpad libre — non inclus dans le rapport final · autosave · Ctrl+S
        </span>
        {saved && (
          <span className="text-label text-accent/60 animate-pulse">Saved</span>
        )}
        {dirty && !isPending && (
          <button
            className="btn-primary text-label py-0.5 px-2"
            onClick={() => doSave(value)}
          >
            Save
          </button>
        )}
        {isPending && (
          <span className="text-label text-fg-secondary/40 animate-pulse">Saving…</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden p-3" onFocus={onFocus} onBlur={onBlur}>
        <MarkdownEditor
          value={value}
          onChange={handleChange}
          caseId={case_.id}
          minHeight={500}
          autoResize
          placeholder={'# Notes\n\n- Observation at 14:32 UTC...\n- Lateral movement through PsExec...'}
        />
      </div>
    </div>
  )
}
