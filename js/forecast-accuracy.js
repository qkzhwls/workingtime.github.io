// ═══════════════════════════════════════════════════════════
// 🎯 업무 예상 정확도 — 오차 분해 (순수 함수 · DOM·Firebase 미의존)
//
// 왜 분리했나
//   정확도 화면은 ui-history-prediction.js 안에 있는데, 그 파일은 state.js·firebase 를
//   끌어와서 node 로 import 할 수 없다. 수식이 테스트되지 않으면 '정확도의 정확도'를
//   아무도 확인할 수 없다 — forecast-progress.js 와 같은 이유로 여기로 뺐다.
//
// 무엇을 고치려고 만들었나
//   기존 '시간 오차'(hourErr)는 계획에 없던 업무에 쓴 시간을 계획 쪽에 더한다.
//   그 의도는 맞다 — 안 더하면 늘 '계획보다 많이 했다'로 읽혀 계획을 부풀리게 된다.
//   그런데 그 때문에 계획이 통째로 어긋난 날이 '양호'하게 보인다.
//   실제 예: 2026-09-28 은 직진배송 936·채우기 204·에이블리배송 146 을 계획하고
//   실적이 전부 0(진짜 미착수)인데, 계획 외 업무에 쓴 시간이 분모를 채워 −13% 로 나왔다.
//
//   그래서 하나였던 오차를 셋으로 쪼갠다. hourErr 는 그대로 남긴다(하위호환·대조용).
//     · planHitErr     계획 적중   — 계획한 업무만의 시간 오차. 계획 자체의 품질
//     · unplannedShare 계획 외 유입 — 실제 시간 중 계획에 없던 업무가 차지한 비중
//     · missed         미착수      — 계획 > 0 인데 실적이 0 인 업무
// ═══════════════════════════════════════════════════════════

const 수 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const 양수 = (v) => {
    const n = 수(v);
    return n > 0 ? n : 0;
};

/** 스냅샷에서 '그날 계획에 올라 있던 업무' 판정.
 *  ⚠️ 기존 accuracyRowOf 와 **같은 기준**이어야 한다(수량 > 0 또는 투입시간 > 0).
 *     여기를 바꾸면 '계획 외'로 세는 업무가 달라져 옛 날짜의 숫자가 흔들린다. */
const 계획된키 = (snap) => {
    const keys = new Set();
    Object.entries(snap?.tasks || {}).forEach(([k, v]) => { if (양수(v) > 0) keys.add(k); });
    Object.entries(snap?.timeTasks || {}).forEach(([k, v]) => { if (양수(v?.minutes) > 0) keys.add(k); });
    return keys;
};

/** 업무별 '계획 시간(인시)'을 스냅샷만으로 재현한다.
 *  수량형: 물량 ÷ 그날 기준 UPH. UPH 를 안 얼린 업무는 계획 시간을 낼 수 없어 0.
 *  시간형: 인원 0명 = 그날 안 하는 업무 → 0 (simulateOneDay 과 같은 규칙). */
const 계획시간맵 = (snap) => {
    const out = {};
    const noBaseline = [];
    Object.entries(snap?.tasks || {}).forEach(([k, v]) => {
        const qty = 양수(v);
        if (qty <= 0) return;
        const uph = 양수(snap?.uph?.[k]);
        if (uph > 0) out[k] = qty / uph;
        else { out[k] = 0; noBaseline.push(k); }
    });
    Object.entries(snap?.timeTasks || {}).forEach(([k, v]) => {
        const minutes = 양수(v?.minutes);
        if (minutes <= 0) return;
        // 같은 업무가 수량형에도 남아 있는 잔재 스냅샷에서는 수량형 값을 덮지 않는다.
        // totalHours 는 수량형으로 셌으므로, 덮으면 미착수 시간이 계획 시간을 넘을 수 있다.
        if (Object.prototype.hasOwnProperty.call(out, k)) return;
        const workers = Math.round(양수(v?.workers));
        out[k] = workers > 0 ? minutes / 60 : 0;
    });
    return { planHoursByTask: out, noBaselineKeys: noBaseline.sort() };
};

/** 업무별 실제 투입시간(시간). duration 이 쓰레기면 무시한다.
 *  ⚠️ actualHours 는 **업무명이 없는 기록의 시간도 포함**한다 — 종전 수식(spentMin 합계)과
 *     똑같은 값이어야 '전체 오차'가 옛 날짜에서 흔들리지 않는다.
 *     업무별 배분(actualByTask)에는 당연히 들어갈 수 없으므로 그 차이를 untaggedHours 로 둔다. */
const 실적시간맵 = (day) => {
    const out = {};
    let total = 0, untagged = 0;
    (day?.workRecords || []).forEach(r => {
        const m = 수(r?.duration);
        if (m <= 0) return;
        total += m / 60;
        if (!r?.task) { untagged += m / 60; return; }
        out[r.task] = (out[r.task] || 0) + m / 60;
    });
    return { actualByTask: out, actualHours: total, untaggedHours: untagged };
};

/**
 * 하루치 계획 대비 실제를 분해한다.
 *
 * @param {object} snap 그날 아침의 확정 스냅샷 (tasks·timeTasks·uph·totalHours …)
 * @param {object} day  { id, workRecords[], taskQuantities{} }
 * @returns 기존 필드(planHours·hourDiff·hourErr·unplannedHours …) + 새 지표
 */
export function decomposeAccuracy(snap, day) {
    const s = snap || {};
    const plannedKeys = 계획된키(s);
    const { planHoursByTask, noBaselineKeys } = 계획시간맵(s);
    const { actualByTask, actualHours, untaggedHours } = 실적시간맵(day);

    let actualPlannedHours = 0, unplannedHours = 0;
    Object.entries(actualByTask).forEach(([k, h]) => {
        if (plannedKeys.has(k)) actualPlannedHours += h;
        else unplannedHours += h;
    });

    // 계획 시간의 정본은 '그날 얼린 totalHours' 다. 위에서 재현한 계획시간맵은
    // 업무별 배분(미착수 판정)에만 쓴다 — 재계산값으로 바꾸면 옛 숫자가 흔들린다.
    const planPlannedHours = 양수(s.totalHours);

    // 📌 미착수 — 계획 시간이 있었는데 실적이 0.
    //    수량형은 '시간 기록이 없다'만으로는 미착수가 아니다. 물량만 입력하고
    //    업무 기록을 안 누른 날이 있어서, 그걸 미착수로 세면 거짓으로 부풀려진다.
    //    시간형은 taskQuantities 가 애초에 없으므로 시간 0 만 본다.
    const 수량형 = new Set(Object.keys(s.tasks || {}));
    const missedKeys = [];
    Object.entries(planHoursByTask).forEach(([k, ph]) => {
        if (!(ph > 0)) return;                       // 기준 없는 업무는 판정 불가
        if (양수(actualByTask[k]) > 0) return;
        if (수량형.has(k) && 양수(day?.taskQuantities?.[k]) > 0) return;
        missedKeys.push(k);
    });
    missedKeys.sort();
    const missedPlanHours = missedKeys.reduce((a, k) => a + planHoursByTask[k], 0);

    // 기존 수식 — 그대로 보존한다(화면의 '전체 오차' · 옛 날짜 대조용)
    const planHours = planPlannedHours + unplannedHours;

    return {
        date: day?.id || null,
        // ── 기존 필드 (회귀 금지) ───────────────────────
        planHours,
        actualHours,
        hourDiff: actualHours - planHours,
        hourErr: planHours > 0 ? (actualHours - planHours) / planHours : null,
        unplannedHours,
        // ── 새 지표 ─────────────────────────────────────
        /** 업무명이 없어 어느 쪽으로도 배분할 수 없는 시간 */
        untaggedHours,
        planPlannedHours,
        actualPlannedHours,
        /** 계획 적중 — 계획한 업무만의 시간 오차 */
        planHitErr: planPlannedHours > 0
            ? (actualPlannedHours - planPlannedHours) / planPlannedHours : null,
        /** 계획 외 유입 — 실제 시간 중 계획에 없던 업무 비중 */
        unplannedShare: actualHours > 0 ? unplannedHours / actualHours : null,
        missed: {
            count: missedKeys.length,
            keys: missedKeys,
            planHours: missedPlanHours,
            // 업무별 계획시간은 재현값(uph 반올림)이고 분모는 그날 얼린 totalHours 라
            // 전부 미착수인 날 1.0004 처럼 나올 수 있다 — 100% 를 넘겨 보여 주지 않는다.
            share: planPlannedHours > 0 ? Math.min(1, missedPlanHours / planPlannedHours) : null
        },
        /** 기준 UPH 가 없어 계획 시간을 낼 수 없던 업무 — 미착수 판정에서 빠진다 */
        noBaselineKeys,
        planHoursByTask,
        auto: s.auto === true
    };
}

const 평균 = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

/** 여러 날을 모아 요약 카드용 숫자로 만든다. null 은 분모에서 빼고, 전부 null 이면 null. */
export function summarizeAccuracyRows(rows) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const hit = list.map(r => r.planHitErr).filter(v => v != null);
    const share = list.map(r => r.unplannedShare).filter(v => v != null);
    const hourErrs = list.map(r => r.hourErr).filter(v => v != null);

    return {
        days: list.length,
        autoDays: list.filter(r => r.auto).length,
        manualDays: list.filter(r => !r.auto).length,
        avgPlanHitErr: 평균(hit),
        avgAbsPlanHitErr: 평균(hit.map(Math.abs)),
        avgUnplannedShare: 평균(share),
        avgHourErr: 평균(hourErrs),
        avgAbsHourErr: 평균(hourErrs.map(Math.abs)),
        // 기준 UPH 가 없어 미착수를 판정할 수 없던 날 — '미착수 없음'이 거짓 안심이 되지 않게
        noBaselineDays: list.filter(r => (r.noBaselineKeys || []).length > 0).length,
        missedDays: list.filter(r => (r.missed?.count || 0) > 0).length,
        missedTaskTotal: list.reduce((a, r) => a + (r.missed?.count || 0), 0),
        missedHoursTotal: list.reduce((a, r) => a + 양수(r.missed?.planHours), 0)
    };
}
