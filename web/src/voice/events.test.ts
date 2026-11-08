// The dictation transcript: provider events in, text out. Two cases matter most:
// the provider finishing an utterance on its own must not be mistaken for the
// end of the dictation (that was a real bug), and the Qwen dialect — which
// reports an item's whole current text instead of appending deltas — must reach
// the screen at all (dropping it left the socket silent between utterances,
// which a proxy then closed).
import { describe, expect, it } from 'vitest'
import {
  applyVoiceEvent,
  emptyTranscript,
  endsDictation,
  joinDraft,
  joinSegments,
  onUpstreamLost,
  polishFallback,
  transcriptText,
  type VoiceEvent,
} from './events'

function fold(events: VoiceEvent[]) {
  return events.reduce(applyVoiceEvent, emptyTranscript())
}

describe('applyVoiceEvent', () => {
  it('grows the interim text from deltas', () => {
    const state = fold([
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
    ])
    expect(state.interim).toBe('你好')
    expect(transcriptText(state)).toBe('你好')
  })

  it('promotes a finished utterance into the committed text', () => {
    const state = fold([
      { type: 'delta', text: '你好世' },
      { type: 'done', text: '你好世界' },
    ])
    expect(state.committed).toBe('你好世界')
    expect(state.interim).toBe('')
    expect(transcriptText(state)).toBe('你好世界')
  })

  it('keeps what the deltas produced when completion carries no text', () => {
    const state = fold([
      { type: 'delta', text: '只靠增量' },
      { type: 'done' },
    ])
    expect(state.committed).toBe('只靠增量')
  })

  it('joins several utterances of one dictation', () => {
    const state = fold([
      { type: 'delta', text: '第一句' },
      { type: 'done', text: '第一句' },
      { type: 'delta', text: '第二句' },
      { type: 'done', text: '第二句' },
    ])
    expect(transcriptText(state)).toBe('第一句第二句')
  })

  it('separates latin utterances with a space', () => {
    const state = fold([
      { type: 'delta', text: 'hello' },
      { type: 'done', text: 'hello' },
      { type: 'delta', text: 'world' },
      { type: 'done', text: 'world' },
    ])
    expect(transcriptText(state)).toBe('hello world')
  })

  it('ignores warnings and errors', () => {
    const before = fold([{ type: 'delta', text: 'abc' }])
    expect(applyVoiceEvent(before, { type: 'warning', message: 'no audio' })).toEqual(before)
    expect(applyVoiceEvent(before, { type: 'error', message: 'boom' })).toEqual(before)
  })

  it('ignores deltas with no text', () => {
    expect(transcriptText(applyVoiceEvent(emptyTranscript(), { type: 'delta' }))).toBe('')
  })

  it('appends a dictation onto text the box already had', () => {
    let state = fold([{ type: 'delta', text: '第一段' }])
    state = applyVoiceEvent(state, { type: 'done', text: '第一段' })
    expect(transcriptText(state)).toBe('第一段')
  })
})

describe('endsDictation', () => {
  it('does not end the dictation while the user is still recording', () => {
    expect(endsDictation('recording', { type: 'done' })).toBe(false)
    expect(endsDictation('recording', { type: 'delta', text: 'x' })).toBe(false)
  })

  it('ends the dictation on the completion that follows a release', () => {
    expect(endsDictation('finalizing', { type: 'done', text: '整段' })).toBe(true)
  })

  it('does not end the dictation on a late delta after the release', () => {
    expect(endsDictation('finalizing', { type: 'delta', text: '尾' })).toBe(false)
  })
})

describe('onUpstreamLost', () => {
  it('continues on a new session while the user is still recording', () => {
    expect(onUpstreamLost({ phase: 'recording', reconnects: 0 })).toBe('reconnect')
    expect(onUpstreamLost({ phase: 'recording', reconnects: 4 })).toBe('reconnect')
  })

  it('gives up after the allowance and finalizes instead', () => {
    expect(onUpstreamLost({ phase: 'recording', reconnects: 5 })).toBe('finalize')
  })

  it('finalizes when the loss happens while connecting or finalizing', () => {
    expect(onUpstreamLost({ phase: 'connecting', reconnects: 0 })).toBe('finalize')
    expect(onUpstreamLost({ phase: 'finalizing', reconnects: 0 })).toBe('finalize')
  })
})

describe('joinSegments', () => {
  it('does not add a space between CJK', () => {
    expect(joinSegments('你好', '世界')).toBe('你好世界')
  })

  it('adds a space between latin words', () => {
    expect(joinSegments('hello', 'world')).toBe('hello world')
  })

  it('does not add a space before punctuation', () => {
    expect(joinSegments('你好', '，接着')).toBe('你好，接着')
  })

  it('keeps an existing trailing space', () => {
    expect(joinSegments('你好 ', '世界')).toBe('你好 世界')
  })
})

describe('polishFallback', () => {
  it('prefers the polished text when it is a plausible rewrite', () => {
    expect(polishFallback('呃那个我们要不要开会', '我们要不要开会？')).toBe('我们要不要开会？')
  })

  it('keeps the transcript when the polish pass returned nothing', () => {
    expect(polishFallback('原文', '')).toBe('原文')
    expect(polishFallback('原文', '   ')).toBe('原文')
  })

  it('keeps the transcript when the polish pass answered with commentary', () => {
    const essay = '好的，我帮您整理如下：' + '这是一段很长的解释。'.repeat(20)
    expect(polishFallback('原文', essay)).toBe('原文')
  })

  it('keeps a short transcript instead of a request for the text', () => {
    // What a cleaning prompt answers a four-character fragment with, and what
    // the proportional slack used to let through.
    expect(polishFallback('我们走吧', '请输入待清洗的文本')).toBe('我们走吧')
  })

  it('still accepts the punctuation a short transcript earns', () => {
    expect(polishFallback('我们要不要开会', '我们要不要开会？')).toBe('我们要不要开会？')
  })

  it('allows a modest amount of punctuation and filler trimming', () => {
    const raw = '呃那个我想说的是咱们这个语音输入的功能还需要再打磨一下'
    const polished = '我想说的是，咱们这个语音输入功能还需要再打磨一下。'
    expect(polishFallback(raw, polished)).toBe(polished)
  })
})

describe('joinDraft', () => {
  it('uses the dictation as the whole draft when the box was empty', () => {
    expect(joinDraft('', '  你好世界 ')).toBe('你好世界')
  })

  it('separates latin text with a space', () => {
    expect(joinDraft('hello', 'world')).toBe('hello world')
  })

  it('does not add a space before Chinese punctuation', () => {
    expect(joinDraft('你好', '，接着往下说')).toBe('你好，接着往下说')
  })

  it('ignores an empty addition', () => {
    expect(joinDraft('原文', '   ')).toBe('原文')
  })
})
