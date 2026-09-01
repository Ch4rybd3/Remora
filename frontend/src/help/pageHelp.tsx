/**
 * Page help, in one place.
 *
 * Every page carries a `?`. What it says lives here rather than inline, for two
 * reasons: the answers are documentation and want to be written as prose, not
 * threaded through JSX; and keeping them together makes it obvious when a page
 * has none.
 *
 * Keyed by route so a page cannot accidentally show another page's help.
 */
import type { ReactNode } from 'react'

import { HelpExample, HelpPopover } from '../ui/HelpPopover'

interface HelpEntry {
  title: string
  wide?: boolean
  content: ReactNode
}

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>
const Code = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-label text-accent">{children}</code>
)

export const PAGE_HELP: Record<string, HelpEntry> = {
  '/account': {
    title: 'Your account',
    content: (
      <>
        <p>
          Two-factor authentication is enrolled here, by you. An administrator cannot
          do it for you - a factor someone else set up is not a second factor.
        </p>
        <p>
          Recovery codes are shown once, at enrolment. They are stored hashed, so
          nothing can display them again. Each one signs you in if you lose your phone
          and works exactly once.
        </p>
        <p>
          Turning the factor off needs your password <em>and</em> a current code. An
          unattended browser is exactly what a second factor exists to survive.
        </p>
      </>
    ),
  },

  '/artifacts/explorer': {
    title: 'Querying artifacts',
    wide: true,
    content: (
      <>
        <P>
          Every parsed artifact lands here as a table. The query bar speaks RQL; column
          filters and the query combine with AND, so a narrow query plus a column filter
          narrows further rather than widening.
        </P>
        <HelpExample label="Equality and comparison" code={'EventID = "4624"\nProcessId > 1000'} />
        <HelpExample label="Substrings" code={'Computer contains "dc"\nCommandLine startswith "powershell"'} />
        <HelpExample label="Sets and ranges" code={'EventID IN ("4624", "4625", "4648")\nEventID BETWEEN 4600 AND 4700'} />
        <HelpExample label="Regex, CIDR, relative time" code={'CommandLine REGEX "powershell.*-enc"\nIpAddress CIDR "10.0.0.0/8"\n@timestamp LAST 24h'} />
        <HelpExample label="Across every column" code={'~ "mimikatz"'} />
        <HelpExample label="Grouping" code={'(EventID = "4624" OR EventID = "4625") AND NOT Computer = "WS01"'} />
        <P>
          Drag a column header onto the group-by bar to fold the table by that column.
          Drag the edge of a header to resize it; double-click the edge to reset it.
        </P>
        <P>
          The pin in the first column stages a row for the timeline. Pinned rows are
          editable in the panel on the right before they are sent — the title and
          description are pre-filled from the parser, not fixed.
        </P>
      </>
    ),
  },

  '/artifacts/filesystem': {
    title: 'Working with logs',
    content: (
      <>
        <P>
          EVTX files dropped into the case folder are parsed and listed here. Select a
          file in the left sidebar to filter the events to it; select it again to clear.
        </P>
        <P>
          Column filters sit under each header. The <Code>date range</Code> in the toolbar
          filters time — there is deliberately no per-column time filter, because two
          controls for one dimension disagree sooner or later.
        </P>
        <P>
          The Chainsaw tab runs Sigma rules over the selected file. Rules are managed
          under Config → Detection Rules; alerts can be pinned to the timeline the same
          way events can.
        </P>
      </>
    ),
  },

  '/artifacts/pcap': {
    title: 'Reading a capture',
    content: (
      <>
        <P>
          Captures are dissected with tshark into a packet list, which is an ordinary
          artifact table — the filters, column controls and pinning are the same as in
          the Artifact Explorer.
        </P>
        <P>
          Select a packet to see its protocol tree and hexdump. <em>Follow stream</em>{' '}
          reassembles the whole conversation the packet belongs to, in both directions.
        </P>
        <P>
          The original capture is kept alongside the packet list. If it has been purged,
          the list survives but stream reassembly is no longer possible.
        </P>
      </>
    ),
  },

  '/artifacts/registry': {
    title: 'Browsing a hive',
    content: (
      <>
        <P>
          Hives arrive through the drop folder like every other artifact —
          nothing is uploaded from this page. Pick one and navigate it key by
          key.
        </P>
        <P>
          Remora does not decide which keys matter. Shipping a list of
          &ldquo;interesting&rdquo; ones would quietly define what the registry
          means for every investigation run on this tool, and that is the
          analyst&apos;s call. <Code>Amcache</Code>, Shimcache and the shellbags
          in the user hives <em>are</em> parsed into tables, and those appear in
          the Artifact Explorer.
        </P>
        <P>
          Search walks the hive from the root and matches key names, value names
          and value data. It stops on a budget rather than running for minutes
          on a large <Code>SOFTWARE</Code> hive, and says so when it does.
        </P>
        <P>
          Two things this does <strong>not</strong> do, both of which Registry
          Explorer does: transaction logs are never replayed, so a hive
          collected mid-write is read as it stands and flagged; and deleted keys
          are not carved out of unallocated space. Replaying a log means writing
          to evidence.
        </P>
      </>
    ),
  },

  '/artifacts/images': {
    title: 'Disk images',
    wide: true,
    content: (
      <>
        <P>
          Images are read <strong>in place</strong> and never uploaded — a full
          acquisition routinely runs to several hundred GB. Copy them onto the server
          and they appear here.
        </P>
        <HelpExample label="Copy an image to the server" code={'rsync -avP --partial my-image.E01 user@host:/mnt/evidence/'} />
        <HelpExample label="Segmented set" code={'rsync -avP --partial my-image.E0* user@host:/mnt/evidence/'} />
        <P>
          The directory is mounted read-only: Remora can neither modify nor delete an
          acquisition. Extracting a file writes it into the case drop folder, where it is
          ingested like anything else dropped there.
        </P>
        <P>
          The <Code>?</Code> button beside the image list has the full set of transfer
          commands, filled in with this server&apos;s actual paths.
        </P>
      </>
    ),
  },

  '/artifacts/memory': {
    title: 'Memory analysis',
    content: (
      <>
        <P>
          Dumps are analysed with Volatility 3. The default plugins cover the usual first
          pass — process list, network connections, injected code, command lines.
        </P>
        <P>
          Anything Volatility can run is available from the custom command tab. Results
          come back as an artifact table, so they filter and pin like every other
          artifact.
        </P>
        <P>
          A first run on a large dump builds a symbol cache and is slow. Later plugins on
          the same dump are much faster.
        </P>
      </>
    ),
  },

  '/artifacts/binary': {
    title: 'Binary analysis',
    content: (
      <>
        <P>
          Static analysis only: nothing here executes the sample. Headers, sections,
          imports and exports come from LIEF; the disassembly from Capstone.
        </P>
        <P>
          Strings are extracted in ASCII and UTF-16 with their offsets, so a hit can be
          located in the file rather than merely observed.
        </P>
        <P>
          Hashes are computed on upload and are what to search against threat
          intelligence. The CTI Lookup page takes them directly.
        </P>
      </>
    ),
  },

  '/artifacts/cti': {
    title: 'Threat intelligence lookups',
    content: (
      <>
        <P>
          Queries the providers configured under Config → Connectors. A provider with no
          API key is shown but not queried — no silent failures.
        </P>
        <P>
          Auto-query runs every configured provider when an IOC is selected. Turn it off
          to control which lookups leave your network, which matters when the indicator
          itself is sensitive.
        </P>
        <P>
          <strong>Every lookup is an outbound request.</strong> Querying a hash tells the
          provider you have seen that sample.
        </P>
      </>
    ),
  },

  '/cases': {
    title: 'Cases and ingestion',
    content: (
      <>
        <P>
          Each case has a drop folder on the server. Anything copied into it is ingested
          exactly like a browser upload: same detection, same records, same result.
        </P>
        <P>
          A file is only picked up once it has stopped changing, so a large copy in
          progress is never read half-written. Ingested files are moved aside rather than
          deleted.
        </P>
        <P>
          Files dropped without a case land in the inbox and can be assigned from the
          Collection tab of any case.
        </P>
      </>
    ),
  },
}

/** The `?` for a page. Renders nothing when that route has no entry yet. */
export function PageHelp({ route }: { route: string }) {
  const entry = PAGE_HELP[route]
  if (!entry) return null
  return (
    <HelpPopover title={entry.title} wide={entry.wide}>
      {entry.content}
    </HelpPopover>
  )
}
