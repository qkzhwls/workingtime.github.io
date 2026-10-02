// js/lib/record-close.js
//
// 아직 끝나지 않은(ongoing/paused) 업무기록을 이력에 적을 때 **끝을 어디로 볼 것인가**.
//
// 왜 따로 떼어냈나
//   예전에는 `saveProgress` 가 열린 기록의 끝을 그냥 '지금'으로 썼다.
//   그런데 마감 안전망(eodFlushToHistory)은 30분마다 **자정까지** 재시도한다.
//   아무도 '업무 마감'을 누르지 않은 날 22:00 에 저장이 돌면, 10:00 에 시작한 기록이
//   12시간으로 이력에 영구히 박혔다. 아무도 22:00 까지 일했다고 말하지 않았는데.
//
//   상한이라고 있던 `if (duration > 1200) status = 'completed'` 한 줄은 상한이 아니었다.
//   시간을 깎지 않고 상태만 바꿨고, 마감된 날 덧붙이기 경로가 **완료된 기록만** 골라
//   접붙이기 때문에, 20시간을 넘긴 가짜 기록만 정확히 통과시키는 구멍이었다.
//
// 규칙 — 순서가 곧 근거의 세기다
//   ① 퇴근시각이 있으면 그게 끝이다.      사람이 남긴 가장 강한 증거다.
//   ② 증거가 없으면 업무일 종료시각을 넘기지 않는다.  22:00 까지 일했다는 증거는 0이다.
//      단 **업무일 종료 뒤에 시작한 기록**에는 쓰지 않는다 — 그 기록 자체가 '그 시각에
//      일하고 있었다' 는 증거여서, 17:30 으로 당기면 야근 업무가 0분이 된다.
//   ③ 그래도 길면 기록당 상한으로 자른다.  근태가 아예 없는 경우의 마지막 그물.
//
//   `status` 는 **어떤 경우에도 바꾸지 않는다.** 깎는 것은 시간뿐이다.
//   판단 불가(시각 형식이 깨진 기록)면 **아무것도 바꾸지 않는다.** 조용히 0분으로 만들면
//   호출한 쪽의 '0분 기록 버리기' 필터에 걸려 기록이 사라진다.

/** 업무일 종료시각. app-lifecycle.js 의 자동마감이 이 값을 import 해서 쓴다 — 단일 출처. */
export const AUTO_END_TIME = '17:30';

/** 기록 1건의 순근무 상한(분). 근태가 없어 ①②를 모두 빠져나간 경우의 마지막 그물. */
export const MAX_OPEN_RECORD_MINUTES = 720;   // 12시간

/** 0채움 24시간제만 신뢰한다. '9:30' 은 문자열 비교에서 '17:30' 보다 크다. */
export const END_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const 시각인가 = (v) => END_TIME_RE.test(String(v == null ? '' : v));
const 분으로 = (hhmm) => {
    const [h, m] = String(hhmm).split(':');
    return Number(h) * 60 + Number(m);
};
const 시각으로 = (min) => {
    const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};

/**
 * 휴식 구간 사본을 만들고, 열린 휴식이 있으면 끝시각으로 닫는다.
 *
 * ⚠️ `end < start` 인 구간을 만들면 안 된다. 계산에서는 무시되지만 원본에 역순 구간이
 *    영구히 남아 휴식시간 표시와 엑셀 출력이 그걸 그대로 들고 다닌다.
 *    (history-data-manager.js · app-lifecycle.js 의 기존 세 경로와 같게 맞춘 것)
 */
function 휴식닫기(record, endTime) {
    const pauses = Array.isArray(record.pauses) ? record.pauses.map(p => ({ ...p })) : [];
    if (record.status === 'paused' && pauses.length > 0) {
        const lp = pauses[pauses.length - 1];
        if (lp && !lp.end) lp.end = (endTime > lp.start) ? endTime : lp.start;
    }
    return pauses;
}

/**
 * `[start, end]` 안으로 자른 휴식 구간들(분). 범위 밖 휴식은 빼지 않는다.
 *
 * ⚠️ 왜 자르나 — ③ 상한이 끝시각을 앞으로 당기면, 그 뒤에 있는 휴식까지 빼서
 *    실제보다 짧은 시간이 적혔다(예: 00:00 시작 · 15~16시 휴식 · 13:00 으로 당김 → 60분 과소).
 */
function 휴식분들(start, end, pauses) {
    const s = 분으로(start), e = 분으로(end);
    return (pauses || [])
        .filter(p => 시각인가(p && p.start) && 시각인가(p && p.end))
        .map(p => [Math.max(s, 분으로(p.start)), Math.min(e, 분으로(p.end))])
        .filter(([a, b]) => b > a);
}

/** 휴식을 뺀 순근무 분. 시각이 깨져 있으면 null. */
function 순근무분(start, end, pauses) {
    if (!시각인가(start) || !시각인가(end)) return null;
    let total = Math.max(0, 분으로(end) - 분으로(start));
    // 겹치는 휴식을 각각 빼는 것은 utils.js 의 calcElapsedMinutes 와 같은 동작이다
    // (앱 전체가 그렇게 세고 있어 여기서만 다르게 바꾸지 않는다).
    휴식분들(start, end, pauses).forEach(([a, b]) => { total -= (b - a); });
    return Math.max(0, total);
}

/**
 * 순근무가 `budget` 분이 되는 끝시각. 휴식을 건너뛰며 실제로 일한 분만 센다.
 *
 * 단순히 `시작 + budget + 휴식` 으로 계산하면, 그렇게 당긴 끝시각 **뒤로** 밀려난 휴식이
 * 생겨 상한이 새진다(리뷰에서 780분이 통과한 경우).
 */
function 상한끝(start, end, pauses, budget) {
    const s = 분으로(start), e = 분으로(end);
    const 구간 = 휴식분들(start, end, pauses).sort((a, b) => a[0] - b[0]);
    let 현재 = s, 남음 = budget;
    for (const [a, b] of 구간) {
        if (a > 현재) {
            const 일한만큼 = a - 현재;
            if (일한만큼 >= 남음) return 시각으로(현재 + 남음);
            남음 -= 일한만큼;
        }
        if (b > 현재) 현재 = b;   // 겹친 휴식을 두 번 건너뛰지 않는다
    }
    return 시각으로(Math.min(e, 현재 + 남음));
}

/**
 * 열린 기록 1건의 끝시각을 정한다.
 *
 * @param {object} record            업무기록. `startTime` · `status` · `pauses` · `member` 를 본다.
 * @param {object|null} attendance   그 사람의 근태 `{inTime, outTime, status}`. 없어도 된다.
 * @param {string} nowTime           지금 시각 'HH:MM'. 이 값을 넘는 끝시각은 만들지 않는다.
 * @param {object} [opts]            `{dayEnd, maxMinutes}` — 테스트·호출처에서 바꿀 수 있다.
 * @returns {{endTime:string|null, duration:number|null, pauses:Array, reason:string}}
 *   reason: 'not-open'|'invalid'|'out-time'|'day-end'|'cap'|'late-start'|'now'
 *   `endTime === null` 이면 **판단하지 못했다는 뜻이고, 원본을 그대로 두어야 한다.**
 */
export function resolveOpenRecordEnd(record, attendance, nowTime, opts = {}) {
    const dayEnd = 시각인가(opts.dayEnd) ? opts.dayEnd : AUTO_END_TIME;
    const maxMin = Number.isFinite(opts.maxMinutes) ? opts.maxMinutes : MAX_OPEN_RECORD_MINUTES;

    const 열림 = record && (record.status === 'ongoing' || record.status === 'paused');
    if (!열림) return { endTime: null, duration: null, pauses: null, reason: 'not-open' };

    const start = record.startTime;
    if (!시각인가(start) || !시각인가(nowTime)) {
        return { endTime: null, duration: null, pauses: null, reason: 'invalid' };
    }

    let end = nowTime;
    let reason = 'now';

    // ① 퇴근을 찍었으면 그게 끝이다 — 19:00 까지 일한 사람을 깎지 않는 유일한 근거.
    //    `outTime > start` 가 아니면 그 기록과 무관한 퇴근이므로 쓰지 않는다
    //    (마감 경로 saveDayDataToHistory 와 같은 판정).
    //    `<=` 다. `<` 로 두면 '퇴근시각 == 저장시각' 인 순간(퇴근 직후 저장)에 퇴근이
    //    탈락해 ② 로 떨어지고, 그 저장이 그날의 마지막이면 저녁 시간이 영구히 사라진다.
    const out = attendance && attendance.status === 'returned' ? attendance.outTime : null;
    if (시각인가(out) && out > start && out <= end) {
        end = out;
        reason = 'out-time';
    } else if (end > dayEnd && !(start > dayEnd)) {
        // ② 증거가 없으면 업무일 종료시각을 넘기지 않는다.
        //    복구 경로(recoverDailyDataToHistory)가 이미 같은 판단을 한다.
        //
        //    `start > dayEnd` 는 제외한다 — 19:00 에 시작한 기록을 17:30 으로 당기면
        //    0분이 되어, 퇴근을 찍기 전에 안전망이 돌면 야근이 통째로 사라진다.
        //    그 기록이 존재한다는 것 자체가 '그 시각에 일하고 있었다' 는 증거다.
        end = dayEnd;
        reason = 'day-end';
    }

    // 끝시각보다 늦게 시작한 기록 — 음수를 만들지 않고 0분으로 둔다.
    // 기록을 지우지는 않는다. status 가 그대로라 호출처의 0분 필터에 걸리지 않는다.
    if (start > end) {
        const pauses = 휴식닫기(record, start);
        return { endTime: start, duration: 0, pauses, reason: 'late-start' };
    }

    const pauses = 휴식닫기(record, end);
    let duration = 순근무분(start, end, pauses);
    if (duration == null) return { endTime: null, duration: null, pauses: null, reason: 'invalid' };

    // ③ 마지막 그물. 끝시각도 같이 당겨서 `endTime` 과 `duration` 이 어긋나지 않게 한다
    //    (시간만 깎고 끝시각을 두면 화면과 숫자가 서로 다른 말을 한다).
    //    ⚠️ 여기서 휴식을 **다시 닫지 않는다.** 예전엔 당긴 끝시각으로 휴식닫기를 다시
    //       돌려서, 열린 휴식이 0분으로 덮이고 상한도 새졌다(780분 통과).
    if (duration > maxMin) {
        end = 상한끝(start, end, pauses, maxMin);
        duration = 순근무분(start, end, pauses);
        reason = 'cap';
    }

    // 어떤 경로로도 상한을 넘지 않는다. 휴식 데이터가 이상해도 이 단언은 깨지지 않아야 한다.
    return { endTime: end, duration: Math.min(duration, maxMin), pauses, reason };
}

/**
 * 기록 배열의 열린 기록들을 한꺼번에 정리한다. 원본 배열·객체를 바꾸지 않는다.
 *
 * @param {Array} records            서버에서 읽은 기록들
 * @param {object} dailyAttendance   `{멤버: {inTime, outTime, status}}`
 * @param {string} nowTime           지금 시각 'HH:MM'
 * @param {object} [opts]            resolveOpenRecordEnd 와 같다
 * @returns {{records:Array, clamped:Array}}
 *   clamped: `[{id, member, task, start, end, minutes, reason}]` — 조정한 것만. 로그용.
 */
export function clampOpenRecords(records, dailyAttendance, nowTime, opts = {}) {
    const att = dailyAttendance || {};
    const clamped = [];
    const out = (Array.isArray(records) ? records : []).map(record => {
        const data = { ...record };
        const r = resolveOpenRecordEnd(data, att[data.member], nowTime, opts);
        if (r.endTime == null) return data;   // 판단 불가·이미 완료 → 손대지 않는다

        // ⚠️ status 는 바꾸지 않는다. 예전에 20시간을 넘기면 'completed' 로 바꿨는데,
        //    마감된 날 덧붙이기가 완료된 기록만 골라 접붙여서 가짜 시간을 영구화했다.
        data.endTime = r.endTime;
        data.duration = r.duration;
        data.pauses = r.pauses;

        if (r.reason !== 'now') {
            // `start`·`end` 를 같이 남긴다. 예전엔 `from: nowTime` 을 찍어서
            // 0분 처리(late-start)가 '20:00 → 19:00 으로 당겼다' 로 읽혔다.
            clamped.push({ id: data.id, member: data.member, task: data.task,
                           start: data.startTime, end: r.endTime,
                           minutes: r.duration, reason: r.reason });
        }
        return data;
    });
    return { records: out, clamped };
}
