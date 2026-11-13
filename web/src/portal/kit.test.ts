import { describe, expect, it } from 'vitest'
import adminLayout from '../components/AdminLayout.tsx?raw'
import apiSource from './api.ts?raw'
import uiSource from './ui.ts?raw'

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
]

// Only the object counts: the import block names the same components, so a check
// against the whole file would pass even with the kit missing an entry.
const KIT_OBJECT = uiSource.slice(uiSource.indexOf('export const portalUI'))

describe('the page kit', () => {
  it('hands every component the contract names to the page', () => {
    for (const name of KIT) {
      expect(KIT_OBJECT, `${name} is missing from the kit`).toMatch(new RegExp(`^\\s+${name},$`, 'm'))
    }
  })

  it('binds the data client to the portal console and names the other bases', () => {
    expect(apiSource).toContain('portalConsole: PORTAL_ADMIN_API_BASE')
    expect(apiSource).toContain('admin: ADMIN_API_BASE')
    expect(apiSource).toContain('user: USER_API_BASE')
  })

  it('mounts the account list through the plugin, keeping the shell page as the fallback', () => {
    expect(adminLayout).toContain('PluginPage path="/admin/users"')
    expect(adminLayout).toContain('fallback={<UsersPage />}')
  })
})
