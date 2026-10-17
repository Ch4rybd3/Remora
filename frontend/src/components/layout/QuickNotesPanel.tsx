/**
 * Floating scratchpad panel — reads and writes the current case's quick_notes.
 *
 * Opened from the TopBar when a case is active. The panel is positioned
 * bottom-right so it does not cover the main content area. Auto-saves on
 * change with a 1.5 s debounce, same as NotesTab.
 *
 * Changes are reflected live in NotesTab (and vice-versa) through the shared
 * useQuickNote hook, which writes to the TanStack Query cache on every
 * keystroke so both editors stay in sync without a server round-trip.
 */
import { X, StickyNote } from '../../ui/icons'
import { useQuickNote } from '../../hooks/useQuickNote'
import MarkdownEditor from '../ui/MarkdownEditor'

interface Props {
  caseId: string
  caseTitle: string
  onClose: () => void
}

export default function QuickNotesPanel({ caseId, caseTitle, onClose }: Props) {
  const { value, dirty, saved, isPending, handleChange, doSave, onFocus, onBlur } =
    useQuickNote(caseId)

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 shadow-2xl border border-hairline bg-panel flex flex-col"
      style={{ height: 340 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0 bg-panel/80">
        <StickyNote size={11} className="text-accent shrink-0" />
        <span className="text-label font-medium text-fg flex-1 truncate" title={caseTitle}>
          {caseTitle}
        </span>
        {saved && (
          <span className="text-label text-accent/60 animate-pulse">Saved</span>
        )}
        {dirty && !isPending && (
          <button
            className="text-label text-fg-secondary/50 hover:text-accent transition-colors px-1"
            onClick={() => doSave(value)}
            title="Save now (Ctrl+S)"
          >
            Save
          </button>
        )}
        <button
          onClick={onClose}
          className="text-fg-secondary/40 hover:text-fg-secondary transition-colors"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden" onFocus={onFocus} onBlur={onBlur}>
        <MarkdownEditor value={value} onChange={handleChange} />
      </div>
    </div>
  )
}
