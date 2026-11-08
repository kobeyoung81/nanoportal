// The scheduled-task list is built from the scheduler's own store file, so the
// parsing has to survive what the file actually looks like: missing (nothing
// scheduled yet), empty (the scheduler writes on every change), or truncated
// mid-write. A malformed file must yield an empty list, never a thrown error
// that blanks the panel.
import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  formatDuration,
  formatRunTime,
  jobStatus,
  parseCronStore,
  pickRunSession,
  taskChatID,
  taskModeOf,
} from './cronTasks'
import type { SessionSummary } from './api'

const store = JSON.stringify({
  version: 1,
  jobs: [
    {
      id: 'e4deddf7',
      name: 'server patrol',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 5 * * *' },
      payload: { message: 'check the disks', channel: 'web', chatId: 'task-00112233' },
      state: { nextRunAtMs: 1_700_000_000_000, lastRunAtMs: 1_699_000_000_000, lastStatus: 'ok' },
    },
    {
      id: 'abc12345',
      name: 'heartbeat',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      payload: { message: 'ping', channel: 'web', chatId: 'task-44556677' },
      state: {},
    },
  ],
})

function session(id: string, chatId: string): SessionSummary {
  return {
    id,
    agent_id: 'agent-1',
    account_id: 'user-1',
    channel: 'web',
    chat_id: chatId,
    status: 'active',
    message_count: 2,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  }
}

describe('parseCronStore', () => {
  it('reads the jobs out of the scheduler store', () => {
    const jobs = parseCronStore(store)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].name).toBe('server patrol')
  })

  it('treats a missing, empty or malformed file as no tasks', () => {
    expect(parseCronStore(null)).toEqual([])
    expect(parseCronStore('')).toEqual([])
    expect(parseCronStore('{"version":1,"jobs":')).toEqual([])
    expect(parseCronStore('{"version":1}')).toEqual([])
    expect(parseCronStore('[1,2,3]')).toEqual([])
  })

  it('keeps only object entries of the jobs array', () => {
    expect(parseCronStore('{"jobs":[null,{"id":"a"},7]}')).toHaveLength(1)
  })
})

describe('describeSchedule', () => {
  it('describes every interval, cron expression and one-shot', () => {
    expect(describeSchedule({ kind: 'every', everyMs: 60_000 })).toEqual({ kind: 'every', everyMs: 60_000 })
    expect(describeSchedule({ kind: 'cron', expr: '0 5 * * *' })).toEqual({ kind: 'cron', expr: '0 5 * * *' })
    expect(describeSchedule({ kind: 'at', atMs: 123 })).toEqual({ kind: 'at', atMs: 123 })
  })

  it('falls back to unknown when the schedule is incomplete', () => {
    expect(describeSchedule(undefined).kind).toBe('unknown')
    expect(describeSchedule({ kind: 'every' }).kind).toBe('unknown')
    expect(describeSchedule({ kind: 'cron' }).kind).toBe('unknown')
    expect(describeSchedule({ kind: 'nonsense' }).kind).toBe('unknown')
  })

  it('formats intervals at a readable granularity', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(5 * 3600_000)).toBe('5h')
    expect(formatDuration(2 * 86_400_000)).toBe('2d')
  })
})

describe('task chat id and run session', () => {
  it('reads the conversation a task runs in', () => {
    const jobs = parseCronStore(store)
    expect(taskChatID(jobs[0])).toBe('task-00112233')
    expect(taskChatID({ payload: {} })).toBeNull()
  })

  it('picks the newest segment of the task conversation', () => {
    const rows = [
      session('web:task-00112233', 'task-00112233'),
      session('web:task-00112233:v2', 'task-00112233'),
      session('web:other', 'other'),
    ]
    expect(pickRunSession(rows, 'task-00112233')?.id).toBe('web:task-00112233:v2')
    expect(pickRunSession(rows, 'task-missing')).toBeNull()
  })
})

describe('task mode', () => {
  it('reads a task’s own mode and treats anything else as inherit', () => {
    expect(taskModeOf({ payload: { mode: 'plan' } })).toBe('plan')
    expect(taskModeOf({ payload: { mode: 'build' } })).toBe('build')
    expect(taskModeOf({ payload: {} })).toBe('')
    expect(taskModeOf({ payload: { mode: 'turbo' } })).toBe('')
    expect(taskModeOf({})).toBe('')
  })
})

describe('run state', () => {
  it('reports never, ok and error', () => {
    expect(jobStatus(undefined)).toBe('never')
    expect(jobStatus({})).toBe('never')
    expect(jobStatus({ lastRunAtMs: 1, lastStatus: 'ok' })).toBe('ok')
    expect(jobStatus({ lastRunAtMs: 1, lastStatus: 'error' })).toBe('error')
  })

  it('formats a run timestamp and an absent one', () => {
    expect(formatRunTime(undefined, 'en-US')).toBe('')
    expect(formatRunTime(0, 'en-US')).toBe('')
    expect(formatRunTime(1_700_000_000_000, 'en-US')).not.toBe('')
  })
})
