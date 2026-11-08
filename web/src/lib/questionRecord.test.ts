// The question exchange the transcript rebuilds: what was asked (from the tool
// call's arguments) and what the user chose (from the tool's JSON string array
// result). Nothing else in the payload carries the user's answer, so these
// parsers decide whether the transcript shows a question record at all.
import { describe, expect, it } from 'vitest'
import { matchesPendingQuestion, parseAnswers, parseQuestions, questionPairs } from './questionRecord'

const args = JSON.stringify({
  questions: [
    { question: 'Which database?', header: '  Storage  ', options: [{ label: 'MySQL' }, { label: 'Postgres' }] },
    { question: 'Start now?' },
  ],
})

describe('parseQuestions', () => {
  it('reads the questions, trimming the header and dropping an empty one', () => {
    expect(parseQuestions(args)).toEqual([
      { question: 'Which database?', header: 'Storage' },
      { question: 'Start now?' },
    ])
  })

  it('is null for a call that is not a question', () => {
    expect(parseQuestions('{"path":"README.md"}')).toBeNull()
  })

  it('is null for arguments that are not JSON at all', () => {
    expect(parseQuestions('rm -rf /')).toBeNull()
  })

  it('is null when no question carries text', () => {
    expect(parseQuestions('{"questions":[{"question":"   "}]}')).toBeNull()
  })
})

describe('parseAnswers', () => {
  it('keeps one answer per question, in order', () => {
    expect(parseAnswers('["Postgres","yes"]', 2)).toEqual(['Postgres', 'yes'])
  })

  it('leaves the tail null when the result has fewer answers', () => {
    expect(parseAnswers('["Postgres"]', 2)).toEqual(['Postgres', null])
  })

  it('leaves everything null for a result that is not a JSON array', () => {
    expect(parseAnswers('Error: waiting for answer: context canceled', 2)).toEqual([null, null])
    expect(parseAnswers('', 1)).toEqual([null])
    expect(parseAnswers('{"answers":["a"]}', 1)).toEqual([null])
  })

  it('ignores answers past the questions it was told about', () => {
    expect(parseAnswers('["a","b","c"]', 2)).toEqual(['a', 'b'])
  })
})

describe('questionPairs', () => {
  it('pairs each question with its answer', () => {
    expect(questionPairs(args, '["Postgres","yes"]')).toEqual([
      { question: 'Which database?', header: 'Storage', answer: 'Postgres' },
      { question: 'Start now?', answer: 'yes' },
    ])
  })

  it('keeps the questions while the call has no result yet', () => {
    expect(questionPairs(args, '')).toEqual([
      { question: 'Which database?', header: 'Storage', answer: null },
      { question: 'Start now?', answer: null },
    ])
  })

  it('is null for an ordinary tool call, so it renders as one', () => {
    expect(questionPairs('{"command":"ls"}', 'a.md')).toBeNull()
  })
})

describe('matchesPendingQuestion', () => {
  const pairs = questionPairs(args, '')!

  it('matches the pending question on the questions themselves', () => {
    expect(matchesPendingQuestion(pairs, { questions: [{ question: 'Which database?' }, { question: 'Start now?' }] })).toBe(true)
  })

  it('does not match a different ask, a different count, or no pending question', () => {
    expect(matchesPendingQuestion(pairs, { questions: [{ question: 'Which database?' }, { question: 'Later?' }] })).toBe(false)
    expect(matchesPendingQuestion(pairs, { questions: [{ question: 'Which database?' }] })).toBe(false)
    expect(matchesPendingQuestion(pairs, null)).toBe(false)
  })
})
