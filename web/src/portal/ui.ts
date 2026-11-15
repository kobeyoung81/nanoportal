// The shell's component kit, bound to the contract's structural types.
//
// A page lives in another application, so it cannot import these modules; it gets
// them through its context instead. One implementation of each control, one set of
// compiled styles, and a page that still looks like the rest of the console.

import type { PortalUIText } from './contract'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { FormField } from '../components/ui/form-field'
import { Input } from '../components/ui/input'
import { Pagination } from '../components/ui/pagination'
import { Skeleton } from '../components/ui/skeleton'
import { StatusBadge, toneForStatus } from '../components/ui/status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { PageHeader } from '../components/page-header'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { MetricCard } from '../components/ui/metric-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Separator } from '../components/ui/separator'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { Spinner } from '../components/ui/spinner'
import { HeightResizeHandle } from '../components/ui/resize-handle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { FilePanelSlot } from './FilePanelSlot'
import { JsonView } from '../components/JsonView'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

export const portalUI: PortalUIText = {
  Button,
  Input,
  toneForStatus,
  JsonView,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Pagination,
  StatusBadge,
  PageHeader,
  FormField,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  MetricCard,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ConfirmDialog,
  Separator,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  FilePanel: FilePanelSlot,
  Textarea,
  Spinner,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  HeightResizeHandle,
}
