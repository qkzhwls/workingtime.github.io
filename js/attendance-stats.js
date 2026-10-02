// === js/attendance-stats.js ===
// 출근 기록(dailyAttendance)에서 '그날 몇 명이 출근했나'와 '한 사람이 몇 시간 있었나'를 낸다.
//
// 왜 따로 뺐나: 인력 운영 탭의 카드와 근태 손실 시간 차트가 같은 계산을 쓴다.
// 재실시간은 점심 제외·이상값 clamp·옛 데이터 폴백이 붙어 있어, 화면 파일에 묻어 두면
// 다음 사람이 또 한 벌을 더 만든다.
//
// ※ 출근 인원을 세는 코드가 앱 안에 이미 두 곳 더 있다
//    (js/history-daily-renderer.js, js/ui-history-dashboard.js).
//    목적이 조금씩 달라 이번엔 건드리지 않았다. 나중에 모을 후보.

import { getRegularMembersForCount } from './utils.js?v=202610021122';
import { minutesOverlap } from './lib/calc.js?v=202610021122';

// 점심시간 12:30~13:30 (분 단위). 업무 기록은 이미 점심을 빼고 저장되므로
// 재실시간에서도 빼야 분자·분모의 기준이 맞는다.
const LUNCH_START_MIN = 12 * 60 + 30;
const LUNCH_END_MIN = 13 * 60 + 30;

// 재실시간 이상값 방어. 출퇴근이 뒤집히거나 자동 마감이 튄 데이터가 실제로 있었다
// (js/history-data-manager.js 의 autoOutTime < inTime 처리 참고).
const MIN_PRESENCE_MIN = 60;
const MAX_PRESENCE_MIN = 16 * 60;

const trim = (v) => (v == null ? '' : String(v).trim());

/** 'HH:MM' → 분. 형식이 아니면 null. */
export function hhmmToMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(trim(hhmm));
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
}

export const systemAccountSet = (appConfig) => new Set(
    (appConfig?.systemAccounts || [])
        .map(s => (typeof s === 'string' ? trim(s) : trim(s?.name ?? s)))
        .filter(Boolean)
);

/** 그날 인원으로 인정할 이름들 — 그 날짜 재직 정직원 + 그날 등록 알바. */
export function validMemberNames(day, appConfig) {
    const names = getRegularMembersForCount(appConfig, day?.id || null);
    const out = new Set([...names].map(trim).filter(Boolean));
    (Array.isArray(day?.partTimers) ? day.partTimers : []).forEach(p => {
        const n = trim(p?.name);
        if (n) out.add(n);
    });
    return out;
}

/**
 * 그날 실제로 출근한 사람들.
 *  - dailyAttendance 에 기록이 있고, 시스템 계정이 아니고, 그날 유효 멤버인 사람.
 *  - 출근 기록이 통째로 없는 옛 데이터는 업무 기록의 이름으로 폴백한다.
 * 반환: Set<string>
 */
export function attendedMembers(day, appConfig) {
    const attendance = (day && typeof day.dailyAttendance === 'object' && day.dailyAttendance) || {};
    const system = systemAccountSet(appConfig);
    const valid = validMemberNames(day, appConfig);

    const out = new Set();
    Object.entries(attendance).forEach(([rawName, att]) => {
        const name = trim(rawName);
        if (!name || system.has(name) || !valid.has(name)) return;
        const status = att && att.status;
        // 출근 기록으로 인정: 상태가 active/returned 이거나, 상태가 없어도 출근시각이 있으면
        if (status === 'active' || status === 'returned' || hhmmToMinutes(att && att.inTime) != null) {
            out.add(name);
        }
    });

    // 유효한 출근자가 하나도 안 잡히면 업무 기록으로 폴백한다.
    // 기록이 통째로 없는 옛 데이터뿐 아니라, 시스템계정만 찍혔거나 지금은 명부에서
    // 지운 옛 알바만 남은 날도 여기서 구제된다(안 그러면 '출근 0명'이 조용히 평균을 깎는다).
    if (out.size === 0) {
        (Array.isArray(day?.workRecords) ? day.workRecords : []).forEach(r => {
            const name = trim(r?.member);
            if (name && !system.has(name) && valid.has(name)) out.add(name);
        });
    }
    return out;
}

/** 출근 기록으로 못 세고 업무 기록으로 대신 센 날인지. (화면에 '추정'을 알리기 위함) */
export function isAttendanceEstimated(day, appConfig) {
    const attendance = (day && typeof day.dailyAttendance === 'object' && day.dailyAttendance) || {};
    if (Object.keys(attendance).length === 0) return true;
    // 키는 있는데 전부 무효(시스템계정·명부에 없는 이름)라 폴백이 돌았는지 확인
    const system = systemAccountSet(appConfig);
    const valid = validMemberNames(day, appConfig);
    return !Object.entries(attendance).some(([rawName, att]) => {
        const name = trim(rawName);
        if (!name || system.has(name) || !valid.has(name)) return false;
        const status = att && att.status;
        return status === 'active' || status === 'returned' || hhmmToMinutes(att && att.inTime) != null;
    });
}

/**
 * 그날 재실시간(출근~퇴근, 점심 제외) 통계.
 *  - 퇴근 기록이 없거나 뒤집힌 사람은 평균에서 뺀다(missingOut 으로 셈).
 *  - 유효한 사람이 하나도 없으면 counted 0 으로 돌려준다. 호출 쪽에서 표준시간으로 폴백할 것.
 *
 * totalMinutes 는 clamp 하지 않은 원값이다. 손실시간(재실 − 업무기록)의 분모로 쓰이므로,
 * 20분 일한 사람을 60분으로 올려 버리면 없는 40분이 손실로 잡힌다.
 * 평균(avgMinutesPerPerson)만 clamp 값을 쓴다 — 이쪽은 필요 인원의 분모라 이상값 방어가 필요하다.
 *
 * 반환: { totalMinutes, avgMinutesPerPerson, counted, missingOut, countedMembers }
 */
export function presenceStats(day, appConfig, attended = null) {
    const raw = (day && typeof day.dailyAttendance === 'object' && day.dailyAttendance) || {};
    // 키를 trim 해 두고 조회한다. attendedMembers 는 trim 된 이름을 담으므로,
    // 원문 키에 공백이 섞여 있으면(' 김철') 조회가 빗나가 재실시간이 통째로 사라진다.
    const attendance = {};
    Object.entries(raw).forEach(([k, v]) => { attendance[trim(k)] = v; });
    const people = attended || attendedMembers(day, appConfig);

    let totalMinutes = 0;
    let clampedTotal = 0;
    let counted = 0;
    let missingOut = 0;
    const countedMembers = new Set();

    people.forEach(name => {
        const att = attendance[name];
        const inMin = hhmmToMinutes(att && att.inTime);
        const outMin = hhmmToMinutes(att && att.outTime);
        if (inMin == null || outMin == null || outMin <= inMin) { missingOut++; return; }

        const net = (outMin - inMin) - minutesOverlap(inMin, outMin, LUNCH_START_MIN, LUNCH_END_MIN);
        if (net <= 0) { missingOut++; return; }

        totalMinutes += Math.min(MAX_PRESENCE_MIN, net);
        clampedTotal += Math.min(MAX_PRESENCE_MIN, Math.max(MIN_PRESENCE_MIN, net));
        counted++;
        countedMembers.add(name);
    });

    return {
        totalMinutes,
        avgMinutesPerPerson: counted > 0 ? clampedTotal / counted : 0,
        counted,
        missingOut,
        countedMembers
    };
}
