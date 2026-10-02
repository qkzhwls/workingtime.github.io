// tests/sim-fold.test.js — 작업량 입력의 '펼침 판정' 과 '저장 대상 판정'
// 실행:  npm test   (= node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    foldReasonFor, FOLD_REASON_TEXT, shouldSaveQty, shouldSaveTime, normalizeTimeEntry,
    FOLD_OUTLIER_RATIO, FOLD_OUTLIER_MIN_ABS, FOLD_OUTLIER_MIN_SAMPLE,
} from '../js/lib/sim-fold.js?v=202610021042';

/** 자동값 그대로인 평범한 수량 행 */
const 평범 = (over = {}) => ({
    kind: 'qty', value: 1200, source: 'cadence-on', uph: 120,
    base: 1200, sample: 20, dirty: false, ...over
});

test('자동값 그대로인 행은 접는다 — 이것이 기본이다', () => {
    assert.equal(foldReasonFor(평범()), null);
    assert.equal(foldReasonFor(평범({ source: 'last7', value: 300, base: 300 })), null);
    assert.equal(foldReasonFor(평범({ source: 'cadence-off', value: 0, base: 0 })), null);
});

test('손댄 칸은 어떤 조건에서도 펼친다', () => {
    assert.equal(foldReasonFor(평범({ dirty: true })), 'edited');
    // 값이 0이고 출처도 평범해도 펼친다 — 방금 넣은 값이 눈앞에서 사라지면 안 된다
    assert.equal(foldReasonFor(평범({ dirty: true, value: 0, base: 0, sample: 0 })), 'edited');
    assert.equal(foldReasonFor({ kind: 'time', dirty: true }), 'edited');
});

test('내가 넣은 값(예정물량)·오늘 실측은 펼친다', () => {
    assert.equal(foldReasonFor(평범({ source: 'planned' })), 'saved');
    assert.equal(foldReasonFor(평범({ source: 'actual' })), 'saved');
});

test("'오늘 할지 불확실' 한 빈도형 업무는 펼친다 — 가장 많이 틀리는 곳", () => {
    assert.equal(foldReasonFor(평범({ source: 'cadence-maybe', value: 0, base: 0 })), 'maybe');
});

test('기준 UPH 가 없는 업무 — 물량이 있을 때만 펼친다', () => {
    // 물량이 있는데 기준 속도가 없다 → 계획 시간이 0 이라 조용히 빠진다. 알려야 한다
    assert.equal(foldReasonFor(평범({ uph: 0, value: 300, base: 300 })), 'no-uph');
    // 물량이 0 이면 계산에 영향이 없다 → 알릴 이유가 없다
    assert.equal(foldReasonFor(평범({ uph: 0, value: 0, base: 0, sample: 0 })), null);
});

test('평소와 크게 다른 날만 펼친다 (비율 · 절대차 · 표본 3중 조건)', () => {
    const ai = (value, base, sample = 20) =>
        foldReasonFor({ kind: 'qty', source: 'ai', uph: 100, value, base, sample });

    // 400 → 700 : 비율 75% · 절대차 300 → 펼친다
    assert.equal(ai(700, 400), 'outlier');
    // 400 → 450 : 비율 12.5% → 접는다
    assert.equal(ai(450, 400), null);
    // 10 → 20 : 비율 100% 지만 절대차 10 뿐 → 접는다 (작은 숫자의 배수에 속지 않는다)
    assert.equal(ai(20, 10), null);
    // 표본이 모자라면 판정하지 않는다
    assert.equal(ai(700, 400, FOLD_OUTLIER_MIN_SAMPLE - 1), null);
    assert.equal(ai(700, 400, FOLD_OUTLIER_MIN_SAMPLE), 'outlier');
    // base 가 0 이면(평소를 모름) 판정하지 않는다
    assert.equal(ai(700, 0), null);
    // 경계: 정확히 기준선
    const 경계 = Math.round(400 * (1 + FOLD_OUTLIER_RATIO));
    assert.equal(ai(경계, 400), 'outlier');
    // 줄어든 쪽도 같이 본다 (절대차 ≥ 50 · 비율 ≥ 50%)
    assert.equal(ai(150, 400), 'outlier');
    // ★ 0 은 판정하지 않는다. computeLast7Avg 는 '물량이 있던 날' 만 평균하므로 base 가
    //   늘 0보다 크고, 0 을 판정하면 '오늘 안 하는 업무' 전부가 -100% 로 걸려 접기가 죽는다.
    assert.equal(ai(0, 400), null);
});

test('입고일정 연동도 평소와 다르면 펼친다', () => {
    const r = foldReasonFor({ kind: 'qty', source: 'incoming', uph: 50,
                              value: 2165, base: 400, sample: 15 });
    assert.equal(r, 'outlier');
});

test('시간형에는 평소대비 판정을 하지 않는다 (value 가 평소 그 자체다)', () => {
    // ⚠️ source 는 실제 코드가 쓰는 문자열이어야 한다.
    //    처음에 없는 값('time-avg')으로 적어서, 저장된 시간형이 접히는 버그를 못 잡았다.
    const r = foldReasonFor({ kind: 'time', source: 'record-avg', value: 900,
                              base: 100, sample: 20 });
    assert.equal(r, null, '시간형은 1인 평균을 그대로 넣으므로 튈 수 없다');
});

test('★ 저장해 둔 시간형 값은 접지 않는다 — source 가 수량형과 다르다', () => {
    // autoTimeValueFor 는 'planned-time' 을 돌려준다. 'planned' 만 보면 사용자가 넣은
    // 시간형 값이 화면에서 사라져, 고치려면 매번 접힘 버튼을 눌러야 한다.
    assert.equal(foldReasonFor({ kind: 'time', source: 'planned-time', value: 300 }), 'saved');
    assert.equal(foldReasonFor({ kind: 'time', source: 'planned-time', value: 0 }), 'saved');
});

test('기본 0명 업무(청소·앵글정리)는 접지 않는다 — 인원을 올릴 수 있어야 한다', () => {
    assert.equal(foldReasonFor({ kind: 'time', value: 0, zeroDefault: true }), 'zero-default');
    // 수량형에는 해당 없음
    assert.equal(foldReasonFor(평범({ value: 0, base: 0, sample: 0, zeroDefault: true })), null);
});

test('우선순위 — 여러 사유가 겹치면 앞의 것이 이긴다', () => {
    // 손댔고 + 저장값이고 + 불확실하고 + UPH 없음 → 'edited'
    assert.equal(foldReasonFor({ kind: 'qty', dirty: true, source: 'planned',
                                 value: 300, uph: 0 }), 'edited');
    // 저장값 + 불확실 → 'saved'
    assert.equal(foldReasonFor({ kind: 'qty', source: 'planned', value: 0, uph: 0 }), 'saved');
});

test('쓰레기 입력에도 throw 하지 않는다', () => {
    assert.doesNotThrow(() => foldReasonFor());
    assert.equal(foldReasonFor(), null);
    assert.equal(foldReasonFor({ kind: 'qty', value: '어', base: null, sample: undefined }), null);
    // value 가 NaN → 0 으로 보고, 0 은 평소대비 판정 대상이 아니다
    assert.equal(foldReasonFor({ kind: 'qty', value: NaN, uph: NaN, base: 400, sample: 20 }), null);
});

test('shouldSaveQty: 손댄 칸만 저장한다', () => {
    assert.equal(shouldSaveQty({ hasInput: true, dirty: true }), true);
    assert.equal(shouldSaveQty({ hasInput: true, dirty: false }), false,
        '자동값이 들어간 칸을 저장하면 28개가 통째로 굳는다 — 이번에 고친 것');
    // 입력칸이 없으면 dirty 여도 저장하지 않는다(목록 재구성 중 0 으로 덮는 사고 방지)
    assert.equal(shouldSaveQty({ hasInput: false, dirty: true }), false);
    assert.equal(shouldSaveQty({}), false);
});

test('shouldSaveTime: 손댄 칸만 — 그리고 두 가지 사고 조합은 막는다', () => {
    assert.equal(shouldSaveTime({ hasInput: true, dirty: true, minutes: 300, workers: 2 }), true);
    assert.equal(shouldSaveTime({ hasInput: true, dirty: false, minutes: 300, workers: 2 }), false);
    assert.equal(shouldSaveTime({ hasInput: false, dirty: true, minutes: 300, workers: 2 }), false);

    // ★ 기본 0명 업무(청소·앵글정리)를 {0,0} 으로 저장하면, 설정을 되돌려도 계속 0 이 된다.
    //   인원을 1 올렸다가 다시 0 으로 내리면 dirty 는 남으므로 'dirty 만' 으로는 못 막는다.
    assert.equal(shouldSaveTime({ hasInput: true, dirty: true, zeroDefault: true,
                                  minutes: 0, workers: 0 }), false);
    // 0명 업무라도 사람이 인원을 올렸으면 저장한다
    assert.equal(shouldSaveTime({ hasInput: true, dirty: true, zeroDefault: true,
                                  minutes: 120, workers: 1 }), true);

    // ★ {분 0, 인원 N} 은 저장하지 않는다. 저장되면 1인 기준이 0 으로 굳어
    //   그 뒤 인원을 몇 명으로 올려도 총 시간이 0 분이 된다.
    assert.equal(shouldSaveTime({ hasInput: true, dirty: true, minutes: 0, workers: 3 }), false);
    // {0,0}(그날 안 함)은 일반 업무에서는 정상적인 저장값이다
    assert.equal(shouldSaveTime({ hasInput: true, dirty: true, minutes: 0, workers: 0 }), true);
});

test('normalizeTimeEntry: 분이 0 이면 인원도 0 — 그날 안 함으로 정리한다', () => {
    // {분 0, 인원 N} 을 저장하면 다음에 읽을 때 1인 기준이 round(0/N)=0 이 되어,
    // 그 뒤 인원을 올려도 영영 0분이 된다. 저장 전에 정리한다.
    assert.deepEqual(normalizeTimeEntry({ minutes: 0, workers: 3 }),
        { minutes: 0, workers: 0, changed: true });
    // 정상값은 그대로
    assert.deepEqual(normalizeTimeEntry({ minutes: 300, workers: 2 }),
        { minutes: 300, workers: 2, changed: false });
    // 이미 {0,0} 이면 바뀐 것이 없다 — 알릴 필요도 없다
    assert.deepEqual(normalizeTimeEntry({ minutes: 0, workers: 0 }),
        { minutes: 0, workers: 0, changed: false });
    // 반올림·음수·쓰레기
    assert.deepEqual(normalizeTimeEntry({ minutes: 299.6, workers: 1.4 }),
        { minutes: 300, workers: 1, changed: false });
    assert.deepEqual(normalizeTimeEntry({ minutes: -5, workers: -2 }),
        { minutes: 0, workers: 0, changed: false });
    assert.deepEqual(normalizeTimeEntry({ minutes: '어', workers: '둘' }),
        { minutes: 0, workers: 0, changed: false });
    assert.doesNotThrow(() => normalizeTimeEntry());
    assert.deepEqual(normalizeTimeEntry(), { minutes: 0, workers: 0, changed: false });
});

test('normalizeTimeEntry + shouldSaveTime 을 실제 저장 순서대로 엮어 본다', () => {
    const 저장할까 = (입력, zeroDefault = false) => {
        const nz = normalizeTimeEntry(입력);
        return shouldSaveTime({ hasInput: true, dirty: true, zeroDefault,
                                minutes: nz.minutes, workers: nz.workers });
    };
    // 분을 비운 일반 업무 → {0,0} 으로 '안 함' 저장
    assert.equal(저장할까({ minutes: 0, workers: 2 }), true);
    // 같은 조작을 기본 0명 업무에 하면 → 원래대로 돌아간 것이라 저장하지 않는다
    assert.equal(저장할까({ minutes: 0, workers: 2 }, true), false);
    // 기본 0명 업무라도 분을 넣었으면 저장한다
    assert.equal(저장할까({ minutes: 120, workers: 1 }, true), true);
});

test('주요 업무(always)는 자동값 그대로여도 접지 않는다', () => {
    // 국내배송·직진배송·에이블리배송·중국제작 같은 매일 보는 숫자
    assert.equal(foldReasonFor(평범({ always: true })), 'core');
    assert.equal(foldReasonFor(평범({ always: false })), null);
    // 값이 0 이어도 보인다
    assert.equal(foldReasonFor(평범({ always: true, value: 0, base: 0, sample: 0 })), 'core');
    // 시간형도 같다
    assert.equal(foldReasonFor({ kind: 'time', source: 'record-avg', value: 0, always: true }), 'core');
});

test('always 는 맨 뒤 순위 — 더 구체적인 사유가 있으면 그쪽을 보여 준다', () => {
    assert.equal(foldReasonFor(평범({ always: true, dirty: true })), 'edited');
    assert.equal(foldReasonFor(평범({ always: true, source: 'planned' })), 'saved');
    assert.equal(foldReasonFor(평범({ always: true, source: 'cadence-maybe', value: 0 })), 'maybe');
    assert.equal(foldReasonFor(평범({ always: true, uph: 0, value: 300, base: 300 })), 'no-uph');
    assert.equal(foldReasonFor({ kind: 'qty', always: true, source: 'ai', uph: 100,
                                 value: 700, base: 400, sample: 20 }), 'outlier');
});

test("FOLD_REASON_TEXT: 'core' 는 글씨가 비어 있다 — 늘 보이는 것이 당연해 사유를 적지 않는다", () => {
    assert.equal(FOLD_REASON_TEXT.core, '');
    assert.equal(FOLD_REASON_TEXT.edited, '고친 칸');
});
