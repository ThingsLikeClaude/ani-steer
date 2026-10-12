import { expect, mock, test } from 'claude-code/testing'

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
