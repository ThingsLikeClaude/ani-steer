import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const lesson = {
  id: 'J-1', ts: 1, text: '아니 배경만 바꾸라고', kind: 'intent', scope: 'personal-project', project: 'unknown', source: 'jev',
  keywords: ['배경', '어둡게'], count: 1, intent: '카드 배경만 어둡게', why: '어둡게를 글자 흐리게로 읽음', lesson: '밝기 요청은 바꿀 속성부터 확인',
}

function jev(on: Parameters<Parameters<typeof test>[1]>[1], answers: Record<string, unknown>) {
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
}

test('a lesson Jev judges to apply rides with the prompt, before Claude answers', async ($, on) => {
  mock.store(on, { cards: [lesson] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.05 } })
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' })
  expect(context?.join('\n')).toContain('밝기 요청은 바꿀 속성부터 확인')
  expect(context?.join('\n')).toContain('카드 배경만 어둡게')
})

test('nothing rides along when no lesson applies', async ($, on) => {
  mock.store(on, { cards: [lesson] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.1 } })
  let context: readonly string[] | undefined = ['unset']
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' })
  expect(context ?? []).toEqual([])
})

const otherReq = { id: 'R-1', text: 'src/generated는 수정 금지', ts: 1, active: 1, project: 'me/other' }

async function sendWith($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], requirements: unknown[]) {
  mock.store(on, { requirements })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, r0_active: { noul: 0.9 }, r0_relevant: { noul: 0.9 }, r1_active: { noul: 0.9 }, r1_relevant: { noul: 0.9 } })
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: 'src/generated 폴더 정리해줘' } as never)
  return (context ?? []).join('\n')
}

test("this project's requirement rides; another project's does not while undecided", async ($, on) => {
  const ownReq = { id: 'R-2', text: 'src/generated 정리는 스크립트로만', ts: 2, active: 1, project: 'unknown' }
  const sent = await sendWith($, on, [otherReq, ownReq])
  expect(sent).toContain('src/generated 정리는 스크립트로만')
  expect(sent).not.toContain('src/generated는 수정 금지')
})

test("another project's requirement rides here once attached", async ($, on) => {
  expect(await sendWith($, on, [{ ...otherReq, alsoIn: ['unknown'] }])).toContain('src/generated는 수정 금지')
})
