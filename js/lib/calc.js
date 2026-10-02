// === js/lib/calc.js ===
// 순수 계산 함수 모음 (DOM/Firebase 의존 없음) — 브라우저 앱과 node 테스트가 함께 사용.
// 여기 있는 함수는 부수효과 없이 입력→출력만 하므로 단위 테스트로 회귀를 막는다.

// 금액 문자열 → 숫자 (","·"$"·"₩"·"원"·공백 제거). 빈칸/"-"/"#" 포함은 null.
export function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim();
    if (!s || s === '-' || s.includes('#')) return null;
    const n = Number(s.replace(/[,\s$₩원]/g, ''));
    return isNaN(n) ? null : n;
}

// 날짜 문자열이 [from, to] 범위에 드는지 (YYYY-MM-DD)
export function inDateRange(dStr, from, to) {
    const d = String(dStr == null ? '' : dStr).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
}

// period('gran:offset' 또는 'custom')을 실제 날짜 범위 {from,to}로 변환.
// gran = day/week/month/year, offset = -1(전)/0(현)/1(후). 주는 월~일 기준.
export function resolvePeriodRange(period, today, customRange) {
    if (period === 'custom') {
        return { from: (customRange && customRange.from) || '', to: (customRange && customRange.to) || '' };
    }
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const [gran, offStr] = String(period).split(':');
    const off = parseInt(offStr, 10) || 0;
    const base = new Date(today + 'T00:00:00');
    if (gran === 'day') {
        const d = new Date(base); d.setDate(base.getDate() + off);
        return { from: fmt(d), to: fmt(d) };
    }
    if (gran === 'week') {
        const dow = (base.getDay() + 6) % 7; // 월=0
        const mon = new Date(base); mon.setDate(base.getDate() - dow + off * 7);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmt(mon), to: fmt(sun) };
    }
    if (gran === 'month') {
        const first = new Date(base.getFullYear(), base.getMonth() + off, 1);
        const last = new Date(base.getFullYear(), base.getMonth() + off + 1, 0);
        return { from: fmt(first), to: fmt(last) };
    }
    if (gran === 'year') {
        const y = base.getFullYear() + off;
        return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return { from: '', to: '' };
}

// 업무 진행 시간(분) = (종료-시작) - 휴식합. HH:MM 문자열, pauses=[{start,end}].
export function calcWorkMinutes(startHHMM, endHHMM, pauses) {
    if (!startHHMM || !endHHMM) return 0;
    const toMin = (hhmm) => {
        const [h, m] = String(hhmm).split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    let total = toMin(endHHMM) - toMin(startHHMM);
    if (total < 0) total = 0;
    (pauses || []).forEach(p => {
        if (!p || !p.start) return;
        const pe = p.end || endHHMM;
        const dur = toMin(pe) - toMin(p.start);
        if (dur > 0) total -= dur;
    });
    return Math.max(0, total);
}

// 두 구간 [aStart,aEnd] 와 [bStart,bEnd]의 겹치는 분(minute) 수.
export function minutesOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// 점심시간 경계(자정부터의 분). 12:30~13:30.
// ⚠️ 같은 값이 app-logic.js(자동 일시정지) · app-lifecycle.js · attendance-stats.js 에도
//    따로 박혀 있다. 이 파일이 '계산의 출처'이니 새 계산은 여기를 쓴다.
export const LUNCH_START_MIN = 750;   // 12:30
export const LUNCH_END_MIN = 810;     // 13:30

// 시작 시각(분)에서 '작업 시간' workMin 만큼 일했을 때의 **벽시계 시각**(분).
//  점심시간은 일하지 않으므로 그만큼 시계가 더 흐른다.
//    09:00 시작 · 작업 8시간 → 18:00 (점심 1시간 포함해 9시간 뒤)
//    09:00 시작 · 작업 3시간 → 12:00 (점심 전에 끝나므로 그대로)
//  ⚠️ 점심 '중' 에 시작한 경우는 남은 점심만 건너뛴다 — 12:45 시작이면 45분만.
//     (autoPauseForLunch 가 pauseStart = max(업무시작, 12:30) 으로 잡으므로 실제로
//      잃는 시간도 45분이다. 60분을 더하면 15분을 두 번 세는 셈이 된다)
//  skipLunch=false 면 점심을 무시하고 그냥 더한다(주말 등).
export function addWorkMinutes(startMin, workMin, { lunchStart = LUNCH_START_MIN,
                                                   lunchEnd = LUNCH_END_MIN,
                                                   skipLunch = true } = {}) {
    const s = Number(startMin) || 0;
    const w = Number(workMin) || 0;
    if (w <= 0) return s;
    if (!skipLunch) return s + w;
    if (!(lunchEnd > lunchStart)) return s + w;
    if (s >= lunchEnd) return s + w;                 // 점심 뒤에 시작 — 겹칠 일이 없다
    const 점심전작업 = Math.max(0, lunchStart - s);    // 점심 시작 전에 일할 수 있는 분
    if (w <= 점심전작업) return s + w;                 // 점심 전에 끝난다 (딱 12:30 도 포함)
    const 남은점심 = lunchEnd - Math.max(s, lunchStart);
    return s + w + 남은점심;
}

// 외출로 인한 급여 차감 분.
//  - 점심시간(기본 12:30~13:30, 분 단위 750~810) 겹친 부분은 차감하지 않는다.
//  - graceMin(기본 60분)까지는 무차감. (그 이상 초과분만 차감)
//  start/end 는 분 단위(0~1440). end<=start 또는 null이면 0.
export function outingDeductibleMinutes(startMin, endMin, { lunchStart = LUNCH_START_MIN, lunchEnd = LUNCH_END_MIN, graceMin = 60 } = {}) {
    if (startMin == null || endMin == null || endMin <= startMin) return 0;
    const net = (endMin - startMin) - minutesOverlap(startMin, endMin, lunchStart, lunchEnd);
    return Math.max(0, net - graceMin);
}

// 조퇴로 인한 급여 차감 분. (종업시각까지 빠진 시간 − 점심 겹침)
export function earlyLeaveDeductibleMinutes(startMin, workEndMin = 1080, { lunchStart = LUNCH_START_MIN, lunchEnd = LUNCH_END_MIN } = {}) {
    if (startMin == null || startMin >= workEndMin) return 0;
    return Math.max(0, (workEndMin - startMin) - minutesOverlap(startMin, workEndMin, lunchStart, lunchEnd));
}

// 월급제 예상급여(세전) 계산.
//  - monthlyBase: 월 기본급(주휴 포함, 월 209시간 기준). 시급 = base/209, 분급 = 시급/60.
//  - absentDayCount: 결근한 (평일) 일수 → 1일 8시간분 차감.
//  - weeksWithAbsence: 결근이 있는 주 수 → 그 주 주휴(8시간분) 차감.
//  - earlyLeaveMin: 조퇴로 빠진 분, outingMin: 외출 1시간 초과 분 → 분급으로 차감.
export function computeMonthlySalary({ monthlyBase = 0, absentDayCount = 0, weeksWithAbsence = 0, earlyLeaveMin = 0, outingMin = 0 } = {}) {
    const STD_HOURS = 209, DAY_HOURS = 8;
    const hourly = monthlyBase > 0 ? monthlyBase / STD_HOURS : 0;
    const minute = hourly / 60;
    const absence = absentDayCount * hourly * DAY_HOURS;          // 결근일 차감
    const weeklyHoliday = weeksWithAbsence * hourly * DAY_HOURS;  // 결근 주의 주휴 차감
    const earlyLeave = earlyLeaveMin * minute;                    // 조퇴 차감
    const outing = outingMin * minute;                            // 외출(1시간 초과) 차감
    const totalDeduction = absence + weeklyHoliday + earlyLeave + outing;
    const estimated = Math.max(0, monthlyBase - totalDeduction);
    return { hourly, minute, absence, weeklyHoliday, earlyLeave, outing, totalDeduction, estimated };
}

// 주말 근무 적정(공평) 횟수 계산.
//  - 정원 미설정 날짜는 defaultCap(기본 3) 적용
//  - 하루 1명은 관리자 고정 → 팀원 몫 = Σ max(0, 정원-1)
//  - 1인당 적정 = round(팀원 몫 합계 / 참여 가능 팀원 수)
// dates: 운영(미마감) 주말 날짜 배열, capacityOf(dateStr)->number|undefined
export function weekendFairness(dates, capacityOf, eligibleCount, defaultCap = 3) {
    let openDays = 0, totalCapacity = 0, teamSlots = 0;
    (dates || []).forEach(dateStr => {
        openDays++;
        const set = Number(capacityOf ? capacityOf(dateStr) : 0) || 0;
        const cap = set > 0 ? set : defaultCap;
        totalCapacity += cap;
        teamSlots += Math.max(0, cap - 1);
    });
    const adminSlots = totalCapacity - teamSlots;
    const avg = eligibleCount > 0 ? teamSlots / eligibleCount : 0;
    const recommended = Math.round(avg);
    return { openDays, totalCapacity, teamSlots, adminSlots, avg, recommended };
}
