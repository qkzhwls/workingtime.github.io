// === js/task-throughput.js ===
// 설명: '업무별 처리 속도' 단일 계산기.
//
// 왜 모았나: 같은 걸 재는 함수가 다섯 벌 있었고 정의가 서로 달라, 같은 물량을 넣어도
// 화면마다 필요 인원이 다르게 나왔다. 계산 방식은 화면마다 다를 이유가 있지만
// (기준 속도 vs 실적 평균), 알고리즘이 다섯 벌인 것은 이유가 없다.
//
// ⚠️ 단위 주의 — 예전엔 개/분과 개/시가 이름만 봐서는 구분되지 않아 뒤바꿔 쓰면
//    60배 오차가 조용히 지나갔다. 그래서 함수 이름에 단위를 박아 둔다.
//      · taskSpeedPerMinute() → 개/분
//      · taskUph()           → 개/시 (새 코드는 이쪽을 쓸 것)

/** 하루치를 업무별 { minutes, qty } 로 묶는다. */
export const dailyTaskStats = (day) => {
    const out = {};
    const records = Array.isArray(day?.workRecords) ? day.workRecords : [];
    records.forEach(r => {
        const minutes = Number(r?.duration) || 0;
        if (!r?.task || minutes <= 0) return;
        if (!out[r.task]) out[r.task] = { minutes: 0, qty: 0 };
        out[r.task].minutes += minutes;
    });
    Object.entries(day?.taskQuantities || {}).forEach(([task, q]) => {
        const qty = Number(q) || 0;
        if (qty <= 0) return;
        if (!out[task]) out[task] = { minutes: 0, qty: 0 };
        out[task].qty += qty;
    });
    return out;
};

/**
 * 업무별 처리 속도(개/분).
 *
 * mode
 *   'total'    — 기간 합계 비율 (Σ물량 ÷ Σ투입시간).
 *                물량이 많은 날에 자연히 가중치가 실린다. 실적을 가장 정직하게 요약한다.
 *   'dailyAvg' — 일별 속도를 낸 뒤 단순 평균. 모든 날을 같은 무게로 본다.
 *   'dailyMedian' — 일별 속도의 가운데값. 잘못 기록된 하루에 끌려가지 않는다.
 *                기록을 시작하고 '종료'를 안 누른 건이 830건(2,374시간) 있는데,
 *                그런 날은 그 업무 시간이 하루 끝까지 잡혀 속도가 몇 분의 일로 나온다.
 *                합계 방식은 분모가 통째로 부풀어 그대로 끌려간다 — 실측으로
 *                에이블리배송 UPH 가 49.8 로 나왔지만 실제는 100 안팎이었다.
 *   'bestDays' — 일별 속도 중 빠른 순 topN 일의 평균.
 *                '잘 돌아갔을 때의 속도' = 목표치. 평상시보다 높게 나오는 것이 정상이다.
 *
 * minMinutes — 그날 그 업무에 이만큼 이상 투입된 날만 센다(짧은 기록의 튀는 속도 제외).
 * minSamples — 일별 모드에서 표본이 이보다 적으면 그 업무만 'total'(합계) 값으로 돌려준다.
 *              표본 1~2개짜리 중앙값은 이상치 저항이 0 이라(n=1은 그 하루 값, n=2는 평균)
 *              한 번 잘못 기록된 날에 그대로 끌려간다. 그럴 바엔 합계가 덜 흔들린다.
 * skipDate   — 제외할 날짜(보통 진행 중이라 물량이 덜 찬 '오늘').
 * tasks      — 지정하면 그 업무만, 없는 업무도 0으로 채워서 돌려준다.
 */
const SPEED_MODES = new Set(['total', 'dailyAvg', 'dailyMedian', 'bestDays']);

export const taskSpeedPerMinute = (days, {
    mode = 'total', minMinutes = 0, skipDate = null, topN = 20, tasks = null, minSamples = 0
} = {}) => {
    // ⚠️ 오타 하나가 조용히 다른 숫자를 돌려주면 아무도 모른다(이 파일 머리의 60배 사고와 같은 종류).
    if (!SPEED_MODES.has(mode)) {
        throw new Error(`taskSpeedPerMinute: 모르는 mode '${mode}' (가능: ${[...SPEED_MODES].join(', ')})`);
    }
    const list = Array.isArray(days) ? days : [];
    const totals = {};        // mode 'total'
    const speeds = {};        // mode 'dailyAvg' | 'bestDays'

    list.forEach(day => {
        if (!day || (skipDate && day.id === skipDate)) return;
        const stats = dailyTaskStats(day);
        Object.entries(stats).forEach(([task, s]) => {
            if (tasks && !tasks.has(task)) return;
            // 합계는 어느 모드에서든 모아 둔다 — 일별 표본이 모자랄 때 되돌아갈 값이다
            if (!totals[task]) totals[task] = { minutes: 0, qty: 0 };
            totals[task].minutes += s.minutes;
            totals[task].qty += s.qty;
            if (mode === 'total') return;
            if (s.minutes > 0 && s.minutes >= minMinutes && s.qty > 0) {
                (speeds[task] || (speeds[task] = [])).push(s.qty / s.minutes);
            }
        });
    });

    const out = {};
    if (mode === 'total') {
        Object.entries(totals).forEach(([task, s]) => {
            out[task] = s.minutes > 0 ? s.qty / s.minutes : 0;
        });
    } else {
        const totalOf = (task) => {
            const t = totals[task];
            return (t && t.minutes > 0) ? t.qty / t.minutes : 0;
        };
        // 일별 표본이 아예 없거나 모자란 업무는 합계로 돌려준다.
        // (안 그러면 속도 0 → 계획 시간 0 이 되어, 물량은 보이는데 시간만 조용히 사라진다)
        Object.keys(totals).forEach(task => {
            if (tasks && !tasks.has(task)) return;
            if ((speeds[task] || []).length < Math.max(1, minSamples)) out[task] = totalOf(task);
        });
        Object.entries(speeds).forEach(([task, arr]) => {
            if (arr.length < Math.max(1, minSamples)) { out[task] = totalOf(task); return; }
            if (mode === 'dailyMedian') {
                const v = [...arr].sort((a, b) => a - b);
                const m = Math.floor(v.length / 2);
                // 표본이 짝수일 때 위쪽 값만 고르면 속도가 한 방향으로 치우친다
                out[task] = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
                return;
            }
            const use = (mode === 'bestDays')
                ? [...arr].sort((a, b) => b - a).slice(0, topN)
                : arr;
            out[task] = use.reduce((a, b) => a + b, 0) / use.length;
        });
    }

    // 요청한 업무는 값이 없어도 자리를 만들어 준다(호출부에서 || 0 을 안 잊도록)
    if (tasks) tasks.forEach(t => { if (!(t in out)) out[t] = 0; });
    return out;
};

/** 업무별 처리 속도(개/시). 새로 쓰는 코드는 이 함수를 쓸 것. */
export const taskUph = (days, opts = {}) => {
    const perMin = taskSpeedPerMinute(days, opts);
    const out = {};
    Object.entries(perMin).forEach(([task, v]) => { out[task] = v * 60; });
    return out;
};

/** 팀 전체 종합 UPH(개/시) = 모든 물량 ÷ 모든 투입시간.
 *  업무를 가리지 않고 통으로 본다(검수·재작업 같은 지원 업무도 분모에 들어간다). */
export const overallUph = (days) => {
    let qty = 0, minutes = 0;
    (Array.isArray(days) ? days : []).forEach(day => {
        Object.values(day?.taskQuantities || {}).forEach(q => { qty += Number(q) || 0; });
        (Array.isArray(day?.workRecords) ? day.workRecords : []).forEach(r => {
            minutes += Number(r?.duration) || 0;
        });
    });
    return minutes > 0 ? qty / (minutes / 60) : 0;
};

/** 최근 N일(달력 기준) 만 남긴다. 기준일을 넘기지 않으면 오늘. */
export const recentDays = (days, windowDays, todayStr) => {
    const base = todayStr || new Date().toISOString().slice(0, 10);
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() - windowDays);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (Array.isArray(days) ? days : []).filter(x => typeof x?.id === 'string' && x.id >= from);
};
