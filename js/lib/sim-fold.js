// ═══════════════════════════════════════════════════════════
// 📋 상세 시뮬레이션 — '어느 행을 펼칠지' 와 '어느 칸을 저장할지' (순수 함수)
//
// 왜 분리했나
//   두 판정이 다 사고 이력에서 나온 규칙이라, 테스트 없이 두면 또 깨진다.
//   ui-history-prediction.js 는 state.js·firebase 를 끌어와 node 로 import 할 수 없어
//   그 안에 두면 영원히 테스트가 안 된다(forecast-accuracy.js 와 같은 이유).
//
// 무엇을 고치려고 만들었나
//   ① 작업량 입력이 한 화면에 40칸이다(수량 16 + 시간형 12×2). 평소에는 자동값을 그대로
//      쓰는 칸이 대부분인데 전부 펼쳐져 있어서, 정작 봐야 할 칸이 묻힌다.
//   ② '작업량 저장' 이 화면의 모든 칸을 저장했다. 한 칸 고치고 누르면 자동값까지 28개가
//      '예정물량'(우선순위 2위)으로 굳어, 🔄 자동값을 누르기 전까지 자동 추정(AI 예측·
//      빈도 분석·입고일정 연동)을 영구히 이긴다 — 정확도를 올리려고 만든 추정기들이
//      그 날엔 작동하지 않았다. 실측: 수기 저장이 있는 15일에 거의 모든 업무가 저장돼 있었다.
// ═══════════════════════════════════════════════════════════

/** 자동값이 '평소와 크게 다르다' 고 볼 기준.
 *  코드를 고치지 않고 조정할 수 있도록 상수로 뽑아 둔다(화면에 몇 행이 남는지는 여기서 정해진다). */
export const FOLD_OUTLIER_RATIO = 0.5;      // 평소 대비 ±50%
export const FOLD_OUTLIER_MIN_ABS = 50;     // 절대 하한 — 3 → 6 을 '2배' 로 잡지 않게
export const FOLD_OUTLIER_MIN_SAMPLE = 4;   // 표본이 이보다 적으면 판정하지 않는다

/** '사람이 정한 값' 으로 보는 출처. 수량형과 시간형의 문자열이 다르다. */
const SAVED_SOURCES = new Set(['planned', 'actual', 'planned-time']);

const 수 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * 이 행을 펼칠 이유. **null 이면 접는다.**
 *
 * 우선순위대로 보고 **첫 사유**를 돌려준다(화면 문구에 그대로 쓴다).
 *
 * @param {object} p
 * @param {'qty'|'time'} p.kind      수량형 / 시간형
 * @param {number} p.value           지금 칸에 들어 있는 값(수량 또는 분)
 * @param {string} p.source          autoValueFor 가 알려 준 출처 배지 키
 * @param {number} p.uph             그 업무의 기준 UPH (수량형만 의미 있다)
 * @param {number} p.base            '평소' 값 — computeLast7Avg
 * @param {number} p.sample          표본 수 — analyzeCadence().hits
 * @param {boolean} p.dirty          사람이 이 칸을 손댔는가
 * @param {boolean} p.zeroDefault    simZeroTasks(기본 0명 업무) 인가
 * @param {boolean} p.always         늘 보여야 하는 주요 업무인가(접지 않는다)
 * @returns {null|'edited'|'saved'|'maybe'|'no-uph'|'outlier'|'zero-default'}
 */
export function foldReasonFor({ kind = 'qty', value = 0, source = '', uph = 0,
                                base = 0, sample = 0, dirty = false,
                                zeroDefault = false, always = false } = {}) {
    // ① 사람이 타이핑한 칸은 어떤 조건에서도 접지 않는다.
    //    접히면 방금 넣은 값이 눈앞에서 사라진다.
    if (dirty) return 'edited';

    // ② 내가 정한 값(저장해 둔 예정물량) · 오늘 실측 — 자동값이 아니다
    //    ⚠️ 시간형은 source 문자열이 다르다('planned-time'). 수량형 것만 보면 저장해 둔
    //       시간형 값이 접혀서 화면에서 사라진다 — 사용자가 자기가 넣은 값을 못 찾는다.
    if (SAVED_SOURCES.has(source)) return 'saved';

    // ③ 그날 진행 여부가 불확실한 빈도형 업무. 실측 적중률이 2/3 라 가장 많이 틀리는 곳이다.
    if (source === 'cadence-maybe') return 'maybe';

    // ④ 물량은 잡혔는데 기준 속도가 없어 계획 시간을 못 내는 업무.
    //    진행률·총시간 계산에서 조용히 빠지므로 알려야 한다.
    //    value > 0 이 필수다 — 0 인 칸은 계산에 영향이 없어 알릴 이유가 없다.
    if (kind === 'qty' && 수(value) > 0 && !(수(uph) > 0)) return 'no-uph';

    // ⑤ 자동값이 평소와 크게 다른 날(AI 예측·입고일정 연동이 튀는 경우).
    //    cadence-on·last7 은 value 가 '평소' 그 자체라 구조적으로 튈 수 없어 걸리지 않는다.
    //    시간형도 autoTimeValueFor 가 1인 평균을 그대로 돌려주므로 판정하지 않는다.
    if (kind === 'qty' && 바뀜이큰가(수(value), 수(base), 수(sample))) return 'outlier';

    // ⑥ 기본 0명 업무(청소·앵글정리 등)는 늘 0 이라 접으면 화면에서 아예 사라진다.
    //    그러면 인원을 올릴 방법이 없어진다 — 기존 보호를 그대로 지킨다.
    if (kind === 'time' && zeroDefault) return 'zero-default';

    // ⑦ 주요 업무는 자동값 그대로여도 접지 않는다. 매일 눈으로 확인하는 숫자라,
    //    접히면 '고칠 것이 없다' 가 아니라 '안 보인다' 로 느껴진다.
    //    ⚠️ 맨 뒤에 둔다 — 위의 사유들이 더 구체적이라 그쪽을 먼저 보여 줘야 한다.
    if (always) return 'core';

    return null;
}

function 바뀜이큰가(value, base, sample) {
    if (!(base > 0)) return false;
    // ⚠️ value 0 은 판정하지 않는다.
    //    computeLast7Avg 는 '물량이 있던 날' 만 평균하므로, 한 번이라도 한 업무는 base 가
    //    언제나 0 보다 크다. 그래서 0 을 판정하면 '오늘 안 하는 업무' 전부가 평소대비 -100%
    //    로 걸려 접기가 통째로 무력화된다(실측: 그러면 10행 가까이 계속 펼쳐진다).
    //    '안 하기로 봤는데 실제로는 할 수도 있는' 경우는 cadence-maybe 가 따로 잡는다.
    if (!(value > 0)) return false;
    if (sample < FOLD_OUTLIER_MIN_SAMPLE) return false;
    const 차 = Math.abs(value - base);
    if (차 < FOLD_OUTLIER_MIN_ABS) return false;
    return (차 / base) >= FOLD_OUTLIER_RATIO;
}

/** 펼친 이유를 사람 말로. 화면 배지·title 에 쓴다. */
export const FOLD_REASON_TEXT = {
    edited: '고친 칸',
    saved: '내가 넣은 값',
    // ⚠️ 출처 배지 자리(84px)에 쓰므로 짧아야 한다 — 길면 뒤가 잘려 뜻이 사라진다
    maybe: '진행 불확실',
    'no-uph': '기준 없음',
    outlier: '평소와 다름',
    'zero-default': '기본 0명 업무',
    core: ''        // 주요 업무는 사유를 적지 않는다 — 늘 보이는 것이 당연하다
};

/**
 * 이 수량 칸을 저장할 것인가.
 *
 * ⚠️ 사람이 손댄 칸만 저장한다. 예전에는 화면의 모든 칸을 저장해서,
 *    한 칸 고치고 누르면 자동값까지 통째로 '예정물량' 으로 굳었다.
 * ⚠️ hasInput — 입력칸이 없어 읽지 못한 업무는 손대지 않는다. 0 으로 써 버리면
 *    예정 물량 화면에 넣어 둔 값이 조용히 사라지고, 그 0 이 자동값을 이겨 굳는다
 *    (업무 목록이 늘어난 직후 아직 안 그려진 칸에서 실제로 났던 사고다).
 */
export function shouldSaveQty({ hasInput = false, dirty = false } = {}) {
    return !!hasInput && !!dirty;
}

/**
 * 저장하기 전에 시간형 입력을 정리한다.
 *
 * 분이 0 이면 인원이 몇이든 **'그날 안 함'** 이다. {분 0, 인원 N} 을 그대로 저장하면
 * 다음에 읽을 때 1인 기준 = round(0/N) = 0 이 되어, 인원을 올려도 영영 0분이 된다.
 * 계산(simulateOneDay)도 인원 0 이면 시간 0 으로 보므로 화면 결과와도 어긋나지 않는다.
 *
 * @returns {{minutes:number, workers:number, changed:boolean}}
 *          changed — 사용자가 넣은 값과 달라졌는가(화면과 저장이 달라지면 알려야 한다)
 */
export function normalizeTimeEntry({ minutes = 0, workers = 0 } = {}) {
    const m = Math.max(0, Math.round(수(minutes)));
    const w0 = Math.max(0, Math.round(수(workers)));
    const w = m > 0 ? w0 : 0;
    return { minutes: m, workers: w, changed: w !== w0 };
}

/**
 * 이 시간형 칸을 저장할 것인가. 수량형과 같은 'dirty 만' 규칙에 **두 가지 가드를 더** 둔다.
 *
 * ⚠️ zeroDefault — 기본 0명 업무(청소·앵글정리)를 {0,0} 으로 저장하면 안 된다.
 *    저장값이 자동값을 이기므로 배지가 '저장값' 으로 바뀌어 사용자가 0 으로 정한 것처럼 보이고,
 *    관리자가 설정(simTimeTasksZero)을 되돌려도 계속 0 으로 남는다.
 *    '손대지 않았으면 저장 안 함' 만으로는 못 막는다 — 인원을 1 올렸다가 다시 0 으로 내리면
 *    dirty 는 남으므로 그대로 통과한다.
 *
 * ⚠️ minutes 0 인데 workers > 0 인 조합도 저장하지 않는다.
 *    그 값이 저장되면 다음 진입에서 unitMinutes = round(0/N) = 0 이 되어,
 *    그 뒤 인원을 몇 명으로 올려도 총 시간이 0 분으로 고착된다('자동값' 으로 지우기 전까지).
 *    분 칸에 넣었다 지운 경우가 그 조합을 만든다.
 */
export function shouldSaveTime({ hasInput = false, dirty = false,
                                 zeroDefault = false, minutes = 0, workers = 0 } = {}) {
    if (!hasInput || !dirty) return false;
    const m = 수(minutes), w = 수(workers);
    if (zeroDefault && m <= 0 && w <= 0) return false;
    if (m <= 0 && w > 0) return false;
    return true;
}
