// tests/clock-in-out.test.js — 출퇴근 시각이 '집계에 들어가는 값' 인가
// 실행:  npm test   (= node --test)
//
// 기대값은 js/attendance-stats.js 의 집계 코드에서 역산한 것이다. 저장은 되는데
// 숫자가 조용히 안 바뀌는 조합을 **저장 전에** 잡는 것이 이 모듈의 목적이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateClockInOut, normalizeClock, netPresenceMinutes,
    MIN_PRESENCE_MIN, MAX_PRESENCE_MIN,
} from '../js/lib/clock-in-out.js?v=202610021228';

const 판정 = (inTime, outTime, opts) => validateClockInOut({ inTime, outTime }, opts);

test('평범한 하루는 통과한다', () => {
    const r = 판정('09:00', '17:30');
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, []);
});

test('★ 퇴근이 출근보다 빠르거나 같으면 막는다', () => {
    // attendance-stats 는 outMin <= inMin 인 사람을 재실시간 집계에서 통째로 뺀다.
    assert.equal(판정('09:00', '09:00').reason, 'out-before-in');
    assert.equal(판정('17:00', '09:00').reason, 'out-before-in');
});

test('★ 점심을 빼면 0분이 되는 구간을 막는다', () => {
    // 12:40~13:00 은 20분처럼 보이지만 전부 점심이라 집계에서 0분이다.
    const r = 판정('12:40', '13:00');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'lunch-zero');
});

test('★ 지난 날짜는 퇴근을 비울 수 없다 — 비우면 집계에서 빠진다', () => {
    assert.equal(판정('09:00', '', { isPast: true }).reason, 'no-out-on-past');
    assert.equal(판정('09:00', null, { isPast: true }).reason, 'no-out-on-past');
    // 오늘은 아직 근무 중일 수 있으니 허용한다.
    assert.equal(판정('09:00', '', { isPast: false }).ok, true);
    assert.equal(판정('09:00', null).ok, true);
});

test('★ 0채움이 아닌 시각은 거부한다 — 앱이 시각을 문자열로 비교한다', () => {
    // '9:30' > '17:30' 이 true 라서, 비0채움이 들어가면 엉뚱한 기록이 0분 처리된다.
    assert.equal(판정('9:00', '17:30').reason, 'in-format');
    assert.equal(판정('09:00', '7:30').reason, 'out-format');
    assert.equal(판정('', '17:30').reason, 'in-format');
    assert.equal(판정('25:00', '17:30').reason, 'in-format');
});

test('★ 상·하한 경고는 막지 않는다. 그리고 순재실시간으로 잰다', () => {
    // gross 로 재면 점심이 포함돼 거짓 경고가 뜬다: 07:00~23:10 은 gross 16h10 이지만
    // 순은 15h10 이라 실제로 잘리지 않는다.
    const 거짓경고후보 = 판정('07:00', '23:10');
    assert.equal(거짓경고후보.ok, true);
    assert.deepEqual(거짓경고후보.warnings, [], '점심을 뺀 15시간10분은 상한에 안 걸린다');

    const 진짜상한 = 판정('05:00', '23:00');
    assert.equal(진짜상한.ok, true);
    assert.equal(진짜상한.warnings.length, 1);
    assert.match(진짜상한.warnings[0], /잘라/);

    // 하한도 알린다 — 평균 계산이 60분으로 올려 세서 '보이는 값과 세는 값' 이 달라진다.
    const 짧음 = 판정('09:00', '09:30');
    assert.equal(짧음.ok, true);
    assert.match(짧음.warnings[0], /올려/);
});

test('netPresenceMinutes 는 집계와 같은 값을 낸다', () => {
    assert.equal(netPresenceMinutes('09:00', '17:30'), 8 * 60 + 30 - 60, '점심 1시간을 뺀다');
    assert.equal(netPresenceMinutes('09:00', '12:00'), 180, '점심 전에 끝나면 안 뺀다');
    assert.equal(netPresenceMinutes('13:30', '17:30'), 240, '점심 후에 시작하면 안 뺀다');
    assert.equal(netPresenceMinutes('09:00', '09:00'), null);
    assert.equal(netPresenceMinutes('9:00', '17:30'), null);
    assert.equal(MIN_PRESENCE_MIN < MAX_PRESENCE_MIN, true);
});

test('★ 0채움이 아닌 옛 값을 고쳐 준다 — 못 고치면 화면에서 영영 수정 불가다', () => {
    // <input type="time"> 이 '9:10' 을 빈칸으로 버리고, 빈 출근시각은 저장이 거부된다.
    // 하필 그런 레코드가 집계에서 빠져 있어 가장 먼저 고쳐야 하는 값이다.
    assert.equal(normalizeClock('9:10'), '09:10');
    assert.equal(normalizeClock('09:10'), '09:10');
    assert.equal(normalizeClock(' 7:05 '), '07:05');
    assert.equal(normalizeClock('24:00'), null);
    assert.equal(normalizeClock('09:60'), null);
    assert.equal(normalizeClock(''), null);
    assert.equal(normalizeClock(null), null);
    assert.equal(normalizeClock('아침'), null);
});

test('쓰레기 입력에도 던지지 않는다', () => {
    assert.equal(판정(null, null).ok, false);
    assert.equal(판정(undefined, undefined).ok, false);
    assert.equal(validateClockInOut({}).ok, false);
    assert.equal(판정({}, []).ok, false);
});
