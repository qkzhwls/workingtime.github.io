// js/lib/clock-in-out.js
//
// 출퇴근 시각이 **집계에 들어가는 값인가**를 판정한다.
//
// 왜 순수 함수인가
//   같은 검사가 모달 쪽과 저장 함수 쪽에 따로 복사돼 있었다. 그러면 한쪽만 고쳐지고,
//   더 나쁘게는 "저장은 됐는데 숫자가 안 바뀐다" 가 된다 — 이 기능이 고치려던 바로 그 증상이다.
//   판정 규칙은 전부 js/attendance-stats.js 의 집계 코드에서 역산한 것이다.
//   저 파일이 바뀌면 여기와 tests/clock-in-out.test.js 도 같이 바뀌어야 한다.

/** 0채움 24시간제만 신뢰한다. 앱 곳곳이 시각을 **문자열로** 비교한다('9:30' > '17:30' 이 true). */
export const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 점심 12:30~13:30. 업무기록이 이미 점심을 빼고 저장되므로 재실시간에서도 뺀다. */
export const LUNCH_START_MIN = 12 * 60 + 30;
export const LUNCH_END_MIN = 13 * 60 + 30;

/** 집계가 재실시간을 잘라 세는 상·하한 (attendance-stats.js 의 MIN/MAX_PRESENCE_MIN). */
export const MIN_PRESENCE_MIN = 60;
export const MAX_PRESENCE_MIN = 16 * 60;

const 분으로 = (hhmm) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5));
const 겹침 = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * `'9:10'` 처럼 0채움이 아닌 옛 값을 `'09:10'` 으로 고친다. 고칠 수 없으면 null.
 *
 * 이게 없으면 그런 레코드를 **화면에서 영영 못 고친다** — `<input type="time">` 이
 * 무효값을 빈칸으로 버리고, 빈 출근시각은 저장이 거부되기 때문이다.
 * 하필 그런 레코드가 집계에서 빠져 있어서 가장 먼저 고쳐야 하는 값이다.
 */
export function normalizeClock(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

/** 점심을 뺀 순재실시간(분). 집계가 세는 것과 같은 값. */
export function netPresenceMinutes(inTime, outTime) {
    if (!CLOCK_RE.test(String(inTime)) || !CLOCK_RE.test(String(outTime))) return null;
    const a = 분으로(inTime), b = 분으로(outTime);
    if (b <= a) return null;
    return (b - a) - 겹침(a, b, LUNCH_START_MIN, LUNCH_END_MIN);
}

/**
 * 저장해도 되는 출퇴근인가. **거부 사유와 경고를 같이 돌려준다** —
 * 화면과 저장 함수가 같은 문장을 쓰게 하려는 것이다.
 *
 * @param {{inTime:string, outTime:string|null}} value
 * @param {{isPast?:boolean}} [opts] 과거 날짜인가(오늘이면 '아직 근무 중' 이 정상이다)
 * @returns {{ok:boolean, reason:string|null, message:string|null, warnings:string[]}}
 *   reason: 'in-format'|'out-format'|'out-before-in'|'lunch-zero'|'no-out-on-past'
 */
export function validateClockInOut({ inTime, outTime }, opts = {}) {
    const warnings = [];
    const 들어옴 = String(inTime == null ? '' : inTime).trim();
    const 나감 = outTime == null || String(outTime).trim() === '' ? null : String(outTime).trim();
    const 안됨 = (reason, message) => ({ ok: false, reason, message, warnings });

    if (!CLOCK_RE.test(들어옴)) {
        return 안됨('in-format', '출근시각은 HH:MM 형식이어야 합니다.');
    }

    if (나감 === null) {
        // 과거 날짜에서 퇴근을 비우면 그 사람이 근무시간 집계에서 **통째로 빠진다**
        // (attendance-stats 가 outTime 없는 사람을 missingOut 으로 세고 분자·분모에서 뺀다).
        // 오늘은 아직 근무 중일 수 있으니 허용한다.
        if (opts.isPast) {
            return 안됨('no-out-on-past',
                '지난 날짜는 퇴근시각을 비울 수 없습니다. 비우면 그 사람이 근무시간 집계에서 빠집니다.');
        }
        return { ok: true, reason: null, message: null, warnings };
    }

    if (!CLOCK_RE.test(나감)) {
        return 안됨('out-format', '퇴근시각은 HH:MM 형식이어야 합니다.');
    }
    if (분으로(나감) <= 분으로(들어옴)) {
        return 안됨('out-before-in', '퇴근시각이 출근시각보다 빠르거나 같습니다.');
    }

    const 순 = netPresenceMinutes(들어옴, 나감);
    if (순 <= 0) {
        // 저장은 되는데 숫자만 조용히 틀리는 상태 — 그게 이 함수가 막으려는 것이다.
        return 안됨('lunch-zero',
            '점심시간을 빼면 근무시간이 0분입니다. 근무시간 집계에 들어가지 않습니다.');
    }

    // 아래 둘은 막지 않는다. 집계가 잘라 세기 때문에 '보이는 값과 세는 값이 다르다' 만 알린다.
    // ⚠️ 상·하한 비교는 **순재실시간** 으로 한다. gross(퇴근-출근)로 보면 점심을 포함해
    //    거짓 경고가 뜬다(07:00~23:10 은 gross 16h10 이지만 순은 15h10 이라 잘리지 않는다).
    if (순 > MAX_PRESENCE_MIN) {
        warnings.push(`근무시간 집계는 ${MAX_PRESENCE_MIN / 60}시간으로 잘라 셉니다.`);
    } else if (순 < MIN_PRESENCE_MIN) {
        warnings.push(`평균 재실시간 계산은 ${MIN_PRESENCE_MIN}분으로 올려 셉니다.`);
    }
    return { ok: true, reason: null, message: null, warnings };
}
