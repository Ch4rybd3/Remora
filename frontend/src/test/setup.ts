import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom implements no layout, so it ships no `scrollIntoView`. Components that
// keep a highlighted row visible - any keyboard-navigable list - call it during
// an effect, where the missing method surfaces as an uncaught React error and
// fails a test that was only ever pressing arrow keys. Stubbing it here rather
// than guarding each call site keeps the production code honest about what it
// expects from a browser.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
