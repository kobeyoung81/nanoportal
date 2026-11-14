import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import adminLayout from '../components/AdminLayout.tsx?raw'
import apiSource from './api.ts?raw'
import uiSource from './ui.ts?raw'
import pluginPage from './PluginPage.tsx?raw'
import breadcrumbs from '../components/breadcrumbs.tsx?raw'
import filePanelSlot from './FilePanelSlot.tsx?raw'

// The kit a page receives. A page cannot import these modules, so a name missing
// from the object is a page that cannot render — the failure would otherwise show
// up as a blank screen in another application's build.
//
// Read as source, not imported: the shell's components pull in the i18n module,
// which touches `document`, and this suite runs without a DOM.

const KIT = [
  'Button', 'Input', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent',
  'Badge', 'Skeleton', 'EmptyState', 'Table', 'TableHeader', 'TableBody', 'TableRow',
  'TableHead', 'TableCell', 'Pagination', 'StatusBadge', 'PageHeader', 'FormField',
  'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
  'MetricCard', 'Tooltip', 'TooltipTrigger', 'TooltipContent', 'ConfirmDialog',
  'toneForStatus', 'JsonView',
  'Switch', 'Separator', 'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription',
  'DialogFooter',
]

// Only the object counts: the import block names the same components, so a check
// against the whole file would pass even with the kit missing an entry.
const KIT_OBJECT = uiSource.slice(uiSource.indexOf('export const portalUI'))

describe('the page host', () => {
  it('keeps the crumb setter stable across renders', () => {
    // The provider hands out a new object on every render; a setter that depended
    // on that object would re-run every page's "publish my name" effect, forever.
    expect(pluginPage).toContain('useContext(CrumbLabelContext).setValue')
    expect(pluginPage).toContain('[setCrumbValue, pathname]')
  })

  it('memoizes the breadcrumb context value', () => {
    expect(breadcrumbs).toContain('useMemo(() => ({ value, setValue }), [value])')
  })
})

describe('the page kit', () => {
  it('hands every component the contract names to the page', () => {
    for (const name of KIT) {
      expect(KIT_OBJECT, `${name} is missing from the kit`).toMatch(new RegExp(`^\\s+${name},$`, 'm'))
    }
  })

  it('lends the file browser from the module that owns it, with a local fallback', () => {
    expect(uiSource).toContain('FilePanel: FilePanelSlot')
    expect(filePanelSlot).toContain('provides?.filePanel')
    expect(filePanelSlot).toContain('BuiltInFilePanel')
  })

  it('binds the data client to the portal console and names the other bases', () => {
    expect(apiSource).toContain('portalConsole: PORTAL_ADMIN_API_BASE')
    expect(apiSource).toContain('admin: ADMIN_API_BASE')
    expect(apiSource).toContain('user: USER_API_BASE')
  })

  it('mounts the account list through the plugin, keeping the shell page as the fallback', () => {
    expect(adminLayout).toContain("case '/admin/users':")
    expect(adminLayout).toContain('return <UsersPage />')
  })

  it('mounts the account page through the plugin too', () => {
    expect(appSource).toContain('PluginPage fallback={<MyAccountPage />}')
    expect(appSource).toContain('fallback={<MyAccountPage />}')
  })

  it('hands the user detail route over by pattern', () => {
    expect(adminLayout).toContain('path="users/:id" element={<PluginPage fallback={<UserDetailPage />} />}')
  })

  it('does the same for the runtime snapshot', () => {
    expect(adminLayout).toContain("case '/admin/runtime':")
    expect(adminLayout).toContain('return <RuntimeLogsPage />')
  })

  it('builds the console\'s routes from the same list the menu renders', () => {
    // One source: a screen cannot be in the menu and missing from the router.
    expect(adminLayout).toContain('items.map((item) => (')
    expect(adminLayout).toContain('pageFallback(item.path)')
  })
})
