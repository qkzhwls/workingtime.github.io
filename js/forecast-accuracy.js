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
        /** 업무별 계획 시간(인시) — 수량형은 물량÷그날 얼린 UPH, 시간형은 투입시간 */
        planHoursByTask,
        /** 업무별 실제 시간(인시) */
        actualHoursByTask: actualByTask,
        /** 그날 '시간으로 잡은' 업무 키 — 물량이 없어 수량 비교가 불가능한 업무다 */
        timeKeys: Object.keys(s.timeTasks || {}),
        /** 그날 **계획에 올라 있던** 업무 키.
         *  ⚠️ planHoursByTask > 0 과 다르다 — 기준 UPH 를 못 얼린 업무는 계획이 있어도
         *     계획 시간이 0 이다. 그걸 '계획 외' 로 읽으면 거짓이 된다. */
        plannedKeys: [...plannedKeys],
        auto: s.auto === true
    };
}

/**
 * 업무별 누적 — 여러 날의 분해 결과를 업무 단위로 합친다.
 *
 * 왜 순수 함수인가
 *   이 집계에서 **분자와 분모의 날짜 집합이 어긋나는 버그가 두 번** 났다.
 *   (1) 기준 UPH 가 없던 날은 계획 시간이 0 인데 물량은 그대로라 계획 UPH 가 몇 배로 뛰었다.
 *   (2) 그걸 고치면서 실제 시간만 빼고 실제 물량은 남겨, 이번엔 실제 UPH 가 2배가 됐다.
 *   화면 코드 안에 있으면 테스트가 못 잡는다. 규칙은 하나다 —
 *   **기준 UPH 가 없던 날은 그 업무의 모든 값(물량·시간)을 빼고, 몇 일인지만 남긴다.**
 *
 * @param {Array} rows decomposeAccuracy 결과들(화면이 qty 를 덧붙인 것)
 * @returns {Array} 업무별 누적 + 오차. 계획 업무 먼저(시간 오차 큰 순), 계획 외는 뒤.
 */
export function aggregateByTask(rows) {
    const agg = new Map();
    const 집 = (k) => {
        if (!agg.has(k)) {
            agg.set(k, { key: k, plan: 0, actual: 0, planHours: 0, actualHours: 0,
                         // 그날 계획에 없던 날의 실적 — 계획과 짝지을 수 없으므로 따로 둔다
                         offPlanQty: 0, offPlanHours: 0,
                         noBaseDays: 0, noBaseActualHours: 0, wasPlanned: false, hasQty: false });
        }
        return agg.get(k);
    };

    (Array.isArray(rows) ? rows : []).forEach(r => {
        if (!r) return;
        const noBase = new Set(r.noBaselineKeys || []);
        // ⚠️ '그날' 계획에 있었는지로 가른다. 어떤 날은 계획에 있고 어떤 날은 없는 업무가 흔한데,
        //    계획에 없던 날의 실적을 계획 통에 더하면 계획을 한 번도 어기지 않은 업무가
        //    '시간 오차 +19%' 로 빨갛게 뜬다(그 시간은 일별 지표에서 '계획 외 유입' 이다).
        const planned = new Set(r.plannedKeys || []);
        planned.forEach(k => { 집(k).wasPlanned = true; });

        Object.entries(r.qty || {}).forEach(([k, v]) => {
            const e = 집(k);
            e.hasQty = true;             // 물량으로 재는 업무다(0 이어도 '없음' 과 다르다)
            if (noBase.has(k)) return;   // 기준 없는 날은 통째로 제외
            if (!planned.has(k)) { e.offPlanQty += 수(v?.actual); return; }
            e.plan += 수(v?.plan);
            e.actual += 수(v?.actual);
        });
        Object.entries(r.planHoursByTask || {}).forEach(([k, h]) => {
            const e = 집(k);
            if (noBase.has(k)) { e.noBaseDays++; return; }
            e.planHours += 수(h);
        });
        Object.entries(r.actualHoursByTask || {}).forEach(([k, h]) => {
            const e = 집(k);
            if (noBase.has(k)) { e.noBaseActualHours += 수(h); return; }
            if (!planned.has(k)) { e.offPlanHours += 수(h); return; }
            e.actualHours += 수(h);
        });
    });

    const out = [...agg.values()]
        .filter(e => e.plan > 0 || e.actual > 0 || e.planHours > 0 || e.actualHours > 0
                     || e.offPlanHours > 0 || e.offPlanQty > 0 || e.noBaseDays > 0)
        .map(e0 => {
            // 판정축은 hasQty 하나다 — timeKeys 와 섞어 보다가 '물량 —' 인데 'UPH 470' 이
            // 같이 뜨는 행이 나온 적이 있다.
            const e = { ...e0, isTime: !e0.hasQty };
            const err = (e.hasQty && e.plan > 0) ? (e.actual - e.plan) / e.plan : null;
            const hourErr = e.planHours > 0 ? (e.actualHours - e.planHours) / e.planHours : null;
            // 실제·계획 UPH 는 **같은 날짜 집합**에서 나온다(위 규칙).
            // 계획 외 전용 업무는 계획 쪽 통이 비어 있으므로 계획 외 값으로 본다
            const 실물량 = e.wasPlanned ? e.actual : e.offPlanQty;
            const 실시간 = e.wasPlanned ? e.actualHours : e.offPlanHours;
            const realUPH = (e.hasQty && 실물량 > 0 && 실시간 > 0) ? 실물량 / 실시간 : null;
            const planUPH = (e.hasQty && e.plan > 0 && e.planHours > 0)
                ? e.plan / e.planHours : null;
            const uphErr = (realUPH != null && planUPH > 0) ? (realUPH - planUPH) / planUPH : null;
            // 계획에 없었는데 실제로만 한 업무.
            // ⚠️ planHours 가 아니라 **계획 여부**로 본다 — 기준 UPH 를 못 얼린 업무는
            //    계획이 있어도 계획 시간이 0 이라, 그걸로 판정하면 '계획 외' 로 거짓 표시된다.
            const unplanned = !e.wasPlanned
                && (e.offPlanHours > 0 || e.offPlanQty > 0 || e.noBaseActualHours > 0);
            return { ...e, err, hourErr, realUPH, planUPH, uphErr, unplanned,
                     // 화면이 그릴 값 — 계획 업무는 계획과 짝이 맞는 쪽, 계획 외는 계획 외 쪽
                     showQty: e.wasPlanned ? e.actual : e.offPlanQty,
                     showHours: e.wasPlanned ? e.actualHours : e.offPlanHours };
        });

    // 계획 업무가 먼저(시간이 많이 어긋난 순), 계획 외는 뒤에 모아 실제 시간 큰 순.
    // 한 축에 섞으면 '30분짜리 계획 외' 가 '+88% 핵심 업무' 위로 올라오는 역전이 생긴다.
    const 키 = (t) => (t.hourErr != null ? Math.abs(t.hourErr) : Math.abs(t.err ?? 0));
    const 계획 = out.filter(t => !t.unplanned).sort((a, b) => 키(b) - 키(a));
    const 계획외 = out.filter(t => t.unplanned).sort((a, b) => b.showHours - a.showHours);
    return [...계획, ...계획외];
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
