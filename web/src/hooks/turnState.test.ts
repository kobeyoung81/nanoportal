// The running indicator's last word: the server's turn flag, the transcript's
// own evidence of a compaction in flight (bounded), and the stream's silence.
import { describe, expect, it } from 'vitest'
import { turnLooksAlive, type TurnAliveInput } from './turnState'

const quietMs = 5_000

function input(over: Partial<TurnAliveInput> = {}): TurnAliveInput {
  return {
    serverRunning: false,
    streamingCompaction: false,
    compactionDeadline: 0,
    sinceLastChunkMs: 0,
    quietMs,
    now: 1_000_000,
    ...over,
  }
}

describe('turnLooksAlive', () => {
  it('believes the server flag even with a silent stream', () => {
    expect(turnLooksAlive(input({ serverRunning: true, sinceLastChunkMs: 60_000 }))).toBe(true)
  })

  it('keeps a streaming compaction alive past the quiet window', () => {
    expect(
      turnLooksAlive(
        input({ streamingCompaction: true, compactionDeadline: 1_060_000, sinceLastChunkMs: 40_000 }),
      ),
    ).toBe(true)
  })

  it('drops the compaction evidence once its window lapses', () => {
    expect(
      turnLooksAlive(input({ streamingCompaction: true, compactionDeadline: 999_999, sinceLastChunkMs: 40_000 })),
    ).toBe(false)
  })

  it('lets a recent chunk hold the turn', () => {
    expect(turnLooksAlive(input({ sinceLastChunkMs: 1_000 }))).toBe(true)
  })

  it('reconciles a turn whose stream has gone quiet with nothing to show for it', () => {
    expect(turnLooksAlive(input({ sinceLastChunkMs: 5_000 }))).toBe(false)
  })
})
