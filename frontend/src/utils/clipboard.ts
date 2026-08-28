/**
 * Copy text to the clipboard, on plain HTTP too.
 *
 * `navigator.clipboard` only exists in a secure context - HTTPS or localhost.
 * Remora is routinely reached at `http://<server>:5577` on an internal
 * network, where the modern API is simply undefined and a naive call fails
 * silently: the analyst clicks copy, nothing happens, and nothing says why.
 *
 * So the deprecated `execCommand` path is kept as the fallback rather than as
 * legacy. It is the only one that works where this product is actually used.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through: permission may still be denied even in a secure context.
    }
  }

  const staging = document.createElement('textarea')
  staging.value = text
  // Off-screen rather than hidden: a `display: none` element cannot be
  // selected, and the copy would quietly produce an empty clipboard.
  staging.setAttribute('readonly', '')
  staging.style.position = 'fixed'
  staging.style.top = '-1000px'
  staging.style.opacity = '0'
  document.body.appendChild(staging)

  try {
    staging.select()
    staging.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(staging)
  }
}
