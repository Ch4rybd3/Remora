/**
 * The `actor` field, shared by the timeline and the incident log.
 *
 * Both store it as one comma-separated string on a single column, and both
 * edit it as tags. Keeping the split/join in one place is what stops the two
 * tabs from disagreeing about whitespace - an entry written in one tab and
 * reopened in the other has to round-trip to the same tags.
 */
import type { InputTag } from '../ui/TagInput'

/** The badge a value gets when nothing in the case recognises it. */
export const CUSTOM_TAG_COLOR = 'bg-fg/5 text-fg-secondary border-hairline'

/** Tags to the stored string. */
export function tagsToString(tags: InputTag[]): string {
  return tags.map(t => t.value).join(', ')
}

/**
 * Stored string to tags, colouring each value through `colorOf`.
 *
 * The resolver is the caller's because the two tabs recognise different
 * things: the timeline colours IOCs and assets, the incident log colours the
 * people who have already appeared in the case.
 */
export function stringToTags(
  actor: string,
  colorOf: (value: string) => string = () => CUSTOM_TAG_COLOR,
): InputTag[] {
  if (!actor) return []
  return actor
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(value => ({ value, badgeColor: colorOf(value) }))
}
