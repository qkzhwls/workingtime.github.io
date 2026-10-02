// === js/forecast-progress.js ===
// 설명: '오늘 진행 현황' 계산 — 업무 기록(workRecords)에서 지금까지 쓴 시간(인시)을 뽑아
//       계획(시뮬레이션)과 맞춰 본다.
//
// ⚠️ 물량은 여기서 보지 않는다.
//    처리량은 업무를 '끝낼 때' 한 번에 들어오므로(app-logic.js), 진행 중인 업무의 물량은 알 수 없다.
//    낮에는 시간만 보고, 물량 비교는 마감 후 '정확도' 화면에서 한다.

import { calcElapsedMinutes } from './utils.js?v=202610021122';
import { addWorkMinutes, LUNCH_START_MIN, LUNCH_END_MIN } from './lib/calc.js?v=202610021122';

/** 'HH:MM' → 자정부터의 분. 형식이 아니면 null */
export const hhmmToMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (!(h >= 0 && h < 48 && mi >= 0 && mi < 60)) return null;
    return h * 60 + mi;
};

/** 자정부터의 분 → 'HH:MM' (24시를 넘어가면 그대로 25:10 처럼 표기해 다음 날임을 알린다) */
export const minToHhmm = (n) => {
    const v = Math.max(0, Math.round(Number(n) || 0));
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

export const nowTimeString = (d = new Date()) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 기록 한 건이 지금까지 실제로 쓴 시간(분).
 *  - 완료  : 저장된 duration 그대로
 *  - 진행 중: 시작 ~ 지금 (쉰 시간 제외)
 *  - 일시정지: 아직 끝나지 않은 정지 구간은 '지금까지 쉬는 중'으로 보고 빼 준다.
 *             (열린 정지 구간을 그냥 두면 쉬는 동안에도 시간이 계속 늘어난다)
 */
export const spentMinutesOf = (rec, nowStr) => {
    if (!rec || !rec.startTime) return 0;
    if (rec.status === 'completed') {
        const d = Number(rec.duration);
        if (Number.isFinite(d) && d >= 0) return d;
        return calcElapsedMinutes(rec.startTime, rec.endTime, rec.pauses);
    }
    const pauses = (rec.pauses || []).map(p => ({ start: p.start, end: p.end || nowStr }));
    return calcElapsedMinutes(rec.startTime, nowStr, pauses);
};

/** 하루치 기록을 업무별로 묶는다.
 *  반환 byTask: Map(업무명 → { task, spentMin, working, paused, done, members:Set })
 */
export const computeDayProgress = (records, nowStr = nowTimeString()) => {
    const byTask = new Map();
    const activeMembers = new Set();
    let firstStart = null;

    (records || []).forEach(r => {
        if (!r || !r.task) return;
        const e = byTask.get(r.task)
            || { task: r.task, spentMin: 0, working: 0, paused: 0, done: 0, members: new Set() };
        e.spentMin += spentMinutesOf(r, nowStr);
        if (r.status === 'ongoing') {
            e.working++;
            if (r.member) { e.members.add(r.member); activeMembers.add(r.member); }
        } else if (r.status === 'paused') {
            e.paused++;
            if (r.member) e.members.add(r.member);
        } else {
            e.done++;
        }
        byTask.set(r.task, e);

        const st = hhmmToMin(r.startTime);
        if (st != null && (firstStart == null || st < firstStart)) firstStart = st;
    });

    let totalSpentMin = 0;
    byTask.forEach(e => { totalSpentMin += e.spentMin; });

    return {
        byTask,
        totalSpentMin,
        activeWorkers: activeMembers.size,
        activeMembers,
        firstStartMin: firstStart,
        hasRecords: byTask.size > 0
    };
};

/** 업무별 '계획 대비 진행' 줄을 만든다.
 *  planRows: [{ key, label, planHours, kind }]  — 계획에 있는 업무
 *  계획에 없는데 실제로 진행한 업무는 뒤에 '계획 외'로 덧붙인다(시간을 쓴 건 사실이므로 숨기지 않는다).
 */
export const buildProgressRows = (planRows, progress) => {
    const used = new Set();
    const rows = (planRows || []).map(p => {
        const hit = progress.byTask.get(p.key);
        if (hit) used.add(p.key);
        const spentHours = hit ? hit.spentMin / 60 : 0;
        const working = hit ? hit.working : 0;
        const paused = hit ? hit.paused : 0;
        const done = hit ? hit.done : 0;
        let status = 'todo';                                   // 미착수
        if (working > 0) status = 'working';
        else if (paused > 0) status = 'paused';
        else if (done > 0) status = 'ended';                   // 지금은 붙어 있는 사람이 없음
        return {
            key: p.key, label: p.label || p.key, kind: p.kind || 'qty',
            planHours: Math.max(0, Number(p.planHours) || 0),
            spentHours, working, paused, done, status, extra: false,
            noBaseline: !!p.noBaseline,      // 기준 속도가 없어 계획 시간을 못 낸 업무
            members: hit ? [...hit.members] : []
        };
    });

    // 계획에 없던 업무 — 계획 시간 0, '계획 외'로 표시
    progress.byTask.forEach((e, key) => {
        if (used.has(key)) return;
        rows.push({
            key, label: key, kind: 'qty', planHours: 0,
            spentHours: e.spentMin / 60, working: e.working, paused: e.paused, done: e.done,
            status: e.working > 0 ? 'working' : (e.paused > 0 ? 'paused' : 'ended'),
            extra: true, noBaseline: false, members: [...e.members]
        });
    });

    // 계획도 0이고 실제로 하지도 않은 업무는 보여줄 이유가 없다
    // 기준 속도가 없어 계획 시간을 못 낸 업무는, 아직 시작 전이어도 보여 줘야 한다(진행률 분모에서 빠진다)
    const shown = rows.filter(r => r.planHours > 0 || r.spentHours > 0 || r.noBaseline);

    // 진행 중 › 정지 › 계획 남은 순 — 지금 봐야 할 것이 위로 오게
    const rank = { working: 0, paused: 1, todo: 2, ended: 3 };
    shown.sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return (b.planHours - b.spentHours) - (a.planHours - a.spentHours);
    });
    return shown;
};

/** 지금 페이스로 언제 끝날지.
 *  rate(시간당 소화하는 인시) = 지금 붙어 있는 사람 수. 아무도 없으면 가용 인원으로 어림한다.
 *  기준 종료 = 첫 업무 시작 + 하루 업무시간 + 업무 제외시간 + (점심 1시간)
 *
 *  ★ 점심(12:30~13:30)은 **기준 종료와 종료 예상 둘 다** 건너뛴다. 한쪽만 건너뛰면
 *    diffMin(색 판정)이 시각에 따라 60분씩 흔들린다 — 예측이 점심을 지나는 오전에는
 *    1시간 낙관적으로, 점심 뒤에는 정확하게 나와서, 13:30 을 넘기는 순간 초록이 주황으로
 *    튄다. 소진 인시(spentMinutesOf)는 이미 점심 pause 를 빼고 세므로, 남은 작업시간을
 *    벽시계로 옮길 때 점심을 다시 끼워 넣어야 앞뒤가 맞는다.
 *  skipLunch=false 면 점심을 더하지 않는다 — 점심 자동 일시정지가 돌지 않은 날
 *  (주말, 또는 12:30~13:30 에 아무도 앱을 안 열어 pause 가 안 찍힌 평일)은
 *  소진 인시에 점심이 포함돼 있어서, 여기서 또 더하면 이중 계산이 된다.
 *
 *  ⚠️ 기본값이 false 인 것은 **하위호환** 때문이다(기존 호출을 바꾸지 않으려고).
 *     새로 부르는 곳은 점심을 반영할지 **반드시 명시**할 것 — 빠뜨리면 점심 없는 기준이
 *     조용히 나와, 같은 화면의 다른 숫자와 1시간 어긋난다.
 */
export const projectFinish = ({
    planHours, spentHours, activeWorkers, fallbackWorkers,
    nowMin, firstStartMin, dailyHours, excludeMinutes = 0, skipLunch = false
}) => {
    const remainHours = Math.max(0, (Number(planHours) || 0) - (Number(spentHours) || 0));
    const rate = activeWorkers > 0 ? activeWorkers : Math.max(0, Number(fallbackWorkers) || 0);
    const etaMin = rate > 0 ? Math.round((remainHours / rate) * 60) : null;
    const finishMin = etaMin == null ? null : addWorkMinutes(nowMin, etaMin, { skipLunch });

    const startMin = firstStartMin != null ? firstStartMin : 9 * 60;
    const 기준작업분 = Math.round((Number(dailyHours) || 8) * 60)
                    + Math.max(0, Math.round(Number(excludeMinutes) || 0));
    const baseFinishMin = addWorkMinutes(startMin, 기준작업분, { skipLunch });
    const 점심분 = baseFinishMin - startMin - 기준작업분;

    return {
        remainHours, rate, etaMin, finishMin, baseFinishMin,
        diffMin: finishMin == null ? null : finishMin - baseFinishMin,
        usedFallback: activeWorkers <= 0 && rate > 0,
        // 화면 각주용. **기준 종료에** 더해진 점심 분이다(종료 예상에 더해진 값이 아니다 —
        // 점심 뒤에는 예상 쪽에 0 이 더해지므로 둘이 다르다).
        skipLunch: !!skipLunch,
        baseLunchMin: 점심분,
        // 실제로 건너뛴 구간. 점심 중에 시작한 날은 12:30 이 아니라 그 시각부터다
        // (45분만 더했는데 '12:30~13:30' 이라고 쓰면 읽는 사람이 멈춘다).
        baseLunchText: 점심분 > 0
            ? `${minToHhmm(Math.max(startMin, LUNCH_START_MIN))}~${minToHhmm(LUNCH_END_MIN)}`
            : ''
    };
};
