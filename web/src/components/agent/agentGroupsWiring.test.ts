// Wiring that a node test can still pin: the form submits the group, and the
// sidebar renders groups instead of the old flat list.

import { describe, expect, it } from 'vitest'
import formSource from '../agent-form-dialog.tsx?raw'
import pageSource from '../../pages/AgentPage.tsx?raw'
import headerSource from './AgentGroupHeader.tsx?raw'
import sectionSource from './AgentGroupSection.tsx?raw'
import itemSource from './AgentListItem.tsx?raw'
import dotsSource from './AttentionDots.tsx?raw'

describe('agent group wiring', () => {
  it('the agent form submits the chosen group', () => {
    expect(formSource).toContain('group_id: groupID')
    expect(formSource).toContain("t('agentForm.group')")
  })

  it('the sidebar buckets agents and renders group sections', () => {
    expect(pageSource).toContain('bucketAgents(agents, groups, ungrouped)')
    expect(pageSource).toContain('<AgentGroupSection')
    // Pointer drag follows the workbench's own pattern; no drag library.
    expect(pageSource).toContain('usePointerDrag')
    expect(pageSource).toContain("closest('[data-agent-group-section]')")
    expect(pageSource).not.toContain('@dnd-kit')
    // The flat list is gone: every agent row comes from a group section.
    expect(pageSource).not.toContain('agents.map((agent) => (')
  })

  it('the group menu is reachable without a hover', () => {
    // Desktop kept the reveal-on-hover behaviour; a phone has no hover, so the
    // menu stood at opacity 0 and could not be found (nor reached by Tab).
    expect(headerSource).toContain('[@media(hover:none)]:opacity-' + '100')
    expect(headerSource).toContain('focus-visible:opacity-' + '100')
    // The desktop behaviour is unchanged: still hidden until hovered.
    expect(headerSource).toContain('opacity-0 group-hover/header:opacity-100')
  })

  it('the group header offers rename and delete', () => {
    expect(headerSource).toContain("t('agent.groups.rename')")
    expect(headerSource).toContain("t('agent.groups.delete')")
  })

  it('group and agent drags show an insertion line', () => {
    expect(sectionSource).toContain('data-group-drop-line')
    expect(itemSource).toContain('data-agent-drop-line')
    // The ring that read as "drop onto the group" is gone.
    expect(sectionSource).not.toContain('ring-primary/30')
  })

  it('the three attention dots are success/warning/info and none pulse', () => {
    expect(dotsSource).toContain('bg-info')
    expect(dotsSource).toContain('bg-warning')
    expect(dotsSource).toContain('bg-success')
    expect(dotsSource).not.toContain('animate-pulse')
    expect(dotsSource).toContain('size-1.5')
    // Yellow and green are mutually exclusive: a running turn is not "finished
    // but unread".
    expect(dotsSource).toContain('!running && unread')
  })

  it('the agent row has no connectivity dot and its grip comes first', () => {
    // The 8px StatusBadge dot clashed with the unread green dot and was larger
    // than the attention dots; the row now carries only the attention dots.
    expect(itemSource).not.toContain('StatusBadge')
    expect(itemSource.indexOf('onPointerDown={onGripPointerDown}')).toBeLessThan(
      itemSource.indexOf('onClick={onSelect}'),
    )
  })

  it('the agent row is tucked under its group and its grip hugs the icon', () => {
    // ml-3 gives the row its level under the group header; gap-0.5 + pl-1.5
    // bring the grip and the Bot icon closer than the old gap-1 + px-2.5.
    expect(itemSource).toContain('ml-3')
    expect(itemSource).toContain('gap-0.5')
    expect(itemSource).toContain('pl-1.5')
  })

  it('drag is available on touch screens too', () => {
    expect(pageSource).not.toContain('groupsDraggable')
    expect(pageSource).toContain('enabled: true')
  })

  it('the page arranges the order through the grouping endpoint', () => {
    expect(pageSource).toContain('arrangeAgents(')
    expect(pageSource).toContain('data-agent-row')
  })

  it('a conversation row shows the same three dots as its agent', () => {
    // The unread dot used to stop at the agent: with several conversations per
    // agent there was no way to tell which one had finished unread.
    expect(pageSource).toContain('unread={dots.unread}')
    expect(pageSource).toContain('<AttentionDots running={running} awaiting={awaiting} unread={unread} />')
    expect(pageSource).toContain("import { AttentionDots } from '../components/agent/AttentionDots'")
    // One implementation of the dots: the row's own spans are gone.
    expect(pageSource).not.toContain('data-session-running')
    expect(pageSource).not.toContain('data-session-awaiting')
  })

  it('the sidebar heading reads: title, count, new agent, then new group at the right edge', () => {
    // The count belongs to the heading (it used to be pushed to the far right by
    // justify-between), "new agent" follows it, and "new group" is separated by
    // ml-auto so it sits on the other side of the same row.
    const heading = pageSource.slice(
      pageSource.indexOf("t('agent.agents')"),
      pageSource.indexOf("t('agent.groups.new')"),
    )
    expect(heading.length).toBeGreaterThan(0)
    expect(heading).toContain('{agents.length}')
    expect(heading).toContain("t('agent.newAgent')")
    expect(heading).toContain('ml-auto')
    // No justify-between: those two ends are now decided by the order and by
    // ml-auto rather than by the container.
    expect(heading).not.toContain('justify-between')
  })
})
