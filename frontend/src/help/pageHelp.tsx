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
  '/': {
    title: 'Reading the dashboard',
    content: (
      <>
        <P>
          Everything here is counted from open cases. A figure that looks wrong
          is usually a case still marked open that should be closed, rather
          than a miscount.
        </P>
        <P>
          Trend arrows compare the current period against the one before it. A
          period with no activity on either side shows no arrow rather than a
          flat one - nothing happened is not the same as nothing changed.
        </P>
      </>
    ),
  },

  '/artifacts/email': {
    title: 'Analysing a message',
    content: (
      <>
        <P>
          Headers, links and attachments are read from the message as it stands.
          Authentication results (<Code>SPF</Code>, <Code>DKIM</Code>,{' '}
          <Code>DMARC</Code>) are reported as the receiving server recorded them
          - they are a claim in the headers, not something Remora re-verifies.
        </P>
        <P>
          The HTML body renders in a sandboxed frame with remote content
          blocked. That is deliberate: a tracking pixel that loads tells the
          sender their message reached an analyst.
        </P>
        <P>
          Messages also arrive through the drop folder like any other artifact.
          Nothing has to be uploaded from this page.
        </P>
      </>
    ),
  },

  '/knowledge': {
    title: 'The vault',
    content: (
      <>
        <P>
          Shared reference material - tooling notes, rule sets, scripts,
          playbooks - browsed here and managed under{' '}
          <Code>Config &rsaquo; Vaults</Code>. It is deliberately not case data:
          nothing here expires with a collection and nothing here is evidence.
        </P>
        <P>
          What a vault opens into depends on what it holds. An Obsidian folder
          or a ZIP opens in the knowledge editor; a PDF and an image render in
          place.
        </P>
      </>
    ),
  },

  '/config/clients': {
    title: 'Clients',
    content: (
      <>
        <P>
          A client owns cases, and an account can be restricted to a set of
          clients. An account with none attached sees everything - scoping is
          opt-in, so adding a client never silently widens anybody, and
          introducing it changed nothing for accounts that already existed.
        </P>
        <P>
          A scoped account reaching for a case outside its clients receives a{' '}
          <strong>404</strong>, not a 403. Which client an incident belongs to
          is itself information, so the refusal does not confirm that the case
          exists. The attempt is recorded in the audit trail.
        </P>
      </>
    ),
  },

  '/templates': {
    title: 'Case templates',
    content: (
      <>
        <P>
          A template pre-fills a new case: its sections, its default TTPs, its
          starting playbook. Stored as YAML under <Code>templates/</Code>, so a
          template is reviewable and can travel between installations.
        </P>
        <P>
          Editing a template never touches cases already created from it. A case
          is a copy taken at creation, not a live reference - otherwise
          correcting a template would rewrite the history of closed
          investigations.
        </P>
      </>
    ),
  },

  '/report-templates': {
    title: 'Report templates',
    content: (
      <>
        <P>
          DOCX or Markdown, with <Code>{'{{ tags }}'}</Code> replaced at render
          time. The full tag list is in{' '}
          <Code>docs/REPORT_TEMPLATES.md</Code>.
        </P>
        <P>
          A tag that matches nothing renders empty rather than leaving the tag
          in the document. A report going to a client with{' '}
          <Code>{'{{ analyst_name }}'}</Code> still printed in it is worse than
          a blank.
        </P>
        <P>
          Keep the DOCX styles you want in the output: rendering fills the
          template in place and does not restyle it.
        </P>
      </>
    ),
  },

  '/playbooks': {
    title: 'Playbooks',
    content: (
      <>
        <P>
          A playbook is a graph of steps attached to a case, edited in the
          playbook editor. Progress is tracked per case, so the same playbook
          run on two incidents keeps two independent states.
        </P>
        <P>
          Import and export are JSON, which is what makes a playbook shareable
          between installations and reviewable in a pull request.
        </P>
      </>
    ),
  },

  '/config/chainsaw-rules': {
    title: 'Detection rules',
    content: (
      <>
        <P>
          Sigma rules, run by Chainsaw over the event logs in a case. Remora
          ships a rule set and accepts your own; both are listed here with the
          level each rule declares.
        </P>
        <P>
          A rule is only as good as the events it can see. A detection that
          depends on Sysmon finds nothing on a machine where Sysmon was never
          installed - an empty result is not the same as a clean machine.
        </P>
      </>
    ),
  },

  '/config/connectors': {
    title: 'Connectors',
    content: (
      <>
        <P>
          Threat-intelligence services used by CTI Lookup - VirusTotal,
          AbuseIPDB and the rest. Each needs its own API key, entered here and
          stored encrypted.
        </P>
        <P>
          <strong>A lookup sends the indicator to a third party.</strong> An
          internal hostname or a customer URL submitted to a public service is
          disclosure, and on some platforms it is permanent. Configure only what
          the engagement allows.
        </P>
        <P>
          Test a connector after saving it: a wrong key fails at lookup time
          otherwise, in the middle of an investigation.
        </P>
      </>
    ),
  },

  '/config/vaults': {
    title: 'Managing vaults',
    content: (
      <>
        <P>
          The shared reference library that <Code>Vault</Code> browses. Files
          here are not case data: nothing expires with a collection, and nothing
          here is evidence in a chain of custody.
        </P>
        <P>
          That distinction is the point of the separate page. Reference material
          an analyst consults during an investigation must not end up in a
          report as something recovered from the machine.
        </P>
      </>
    ),
  },

  '/users': {
    title: 'Accounts and roles',
    content: (
      <>
        <P>
          Roles are permission sets, not ranks. <Code>read_only</Code> sees
          everything and writes nothing; <Code>executive</Code> sees dashboards
          and reports and no artifact data at all. Neither sits above or below
          the other.
        </P>
        <P>
          Only an owner can hand out <Code>owner</Code>. Everything else an
          administrator can grant.
        </P>
        <P>
          Two-factor authentication is enrolled by the account holder, never by
          an administrator - a factor someone else set up is not a second
          factor.
        </P>
      </>
    ),
  },

  '/audit': {
    title: 'The audit trail',
    content: (
      <>
        <P>
          Who did what, when, and from where. Entries are append-only: nothing
          in the product edits or deletes one, because a trail that can be
          tidied is not a trail.
        </P>
        <P>
          <strong>Refusals are recorded too</strong>, not only successful
          actions - including requests refused with a 404 to avoid confirming
          that a case exists. &ldquo;Who reached for what they could not
          have&rdquo; is where an investigation into the investigators starts.
        </P>
      </>
    ),
  },

  '/design': {
    title: 'The design system',
    content: (
      <>
        <P>
          Every primitive rendered live, reading the same tokens the product
          reads. It cannot drift from what ships: change a token and this page
          changes with it.
        </P>
        <P>
          Its real job is the four-theme comparison. A panel that works in dark
          and vanishes in light is the failure this page exists to catch, and it
          is not one a screenshot review finds.
        </P>
      </>
    ),
  },

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

  '/artifacts/rdp-cache': {
    title: 'Cached remote screens',
    content: (
      <>
        <P>
          <Code>mstsc</Code> caches the remote screen in 64&times;64 tiles so it
          does not resend unchanged parts of the display, and keeps that cache
          on disk. Each tile is a fragment of a session as it was drawn &mdash;
          a window title, a file name, a dialog. It is the only artifact in an
          ordinary triage that shows what an operator <em>saw</em> rather than
          what ran.
        </P>
        <P>
          A tile alone says almost nothing, so they are laid out in contact
          sheets in cache order. The order is the cache&apos;s, which is roughly
          but not exactly chronological: a tile is rewritten when the screen
          region it holds changes.
        </P>
        <P>
          The index behind the sheets is an ordinary table in the Artifact
          Explorer, so tiles can be counted, filtered and pivoted on there
          &mdash; including filtering out the blank ones.
        </P>
        <P>
          Only the RDP8 container is read, which is what every current version
          of <Code>mstsc</Code> writes. Caches from Windows XP and Vista era
          clients use an older layout and are not decoded.
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
