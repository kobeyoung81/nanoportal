// The icon vocabulary a manifest may name, mapped to the shell's own icons.
//
// The list is closed on purpose: a remote cannot hand over a React component, and
// an arbitrary SVG would be a styling and safety problem. This module has no React
// hooks so the menu builder can use it without pulling the registry in.

import {
  Activity,
  Bell,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  Cpu,
  FileText,
  Folder,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  Mic,
  ScrollText,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import type { PanelIcon } from './contract'

export const PANEL_ICON_COMPONENTS: Record<PanelIcon, typeof Layers> = {
  layers: Layers,
  'file-text': FileText,
  folder: Folder,
  'layout-grid': LayoutGrid,
  'book-open': BookOpen,
  activity: Activity,
  bell: Bell,
  blocks: Blocks,
  bot: Bot,
  boxes: Boxes,
  cpu: Cpu,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  'message-square': MessageSquare,
  mic: Mic,
  'scroll-text': ScrollText,
  'sliders-horizontal': SlidersHorizontal,
  users: Users,
}

/** The icon for a manifest's icon name; the contract closes the vocabulary. */
export function iconForPanel(icon: PanelIcon): typeof Layers {
  return PANEL_ICON_COMPONENTS[icon]
}
