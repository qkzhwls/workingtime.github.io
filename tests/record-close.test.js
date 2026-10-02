// tests/record-close.test.js — 아직 끝나지 않은 업무기록의 '끝'을 어디로 보는가
// 실행:  npm test   (= node --test)
//
// 이 규칙이 왜 테스트로 묶여야 하나
//   마감 안전망이 30분마다 자정까지 재시도하는데, 열린 기록의 끝을 '지금'으로 쓰고 있었다.
//   아무도 마감하지 않은 날 22:00 에 저장이 돌면 10:00 기록이 12시간으로 이력에 박혔다.
//   이 숫자는 되돌릴 방법이 없어서(근태 수정 UI 가 없다) 사고가 나면 손으로 복구해야 했다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveOpenRecordEnd, clampOpenRecords,
    AUTO_END_TIME, MAX_OPEN_RECORD_MINUTES,
} from '../js/lib/record-close.js?v=202610021228';

/** 10:00 에 시작해 아직 안 끝난 기록 */
const 열린기록 = (over = {}) => ({
    id: 'r1', member: '멤버A', task: '국내배송',
    startTime: '10:00', status: 'ongoing', pauses: [], ...over
});
const 퇴근 = (outTime) => ({ inTime: '09:00', outTime, status: 'returned' });

// ── ① 퇴근시각이 가장 강한 증거다 ────────────────────────────────

test('★ 퇴근 19:00 을 찍었으면 19:00 이다 — 정당한 연장근무를 깎지 않는다', () => {
    const r = resolveOpenRecordEnd(열린기록(), 퇴근('19:00'), '22:00');
    assert.equal(r.endTime, '19:00');
    assert.equal(r.duration, 540);
    assert.equal(r.reason, 'out-time');
});

test('퇴근 15:00 + 저장은 22:00 → 15:00. 조퇴한 사람을 종일 일한 것으로 만들지 않는다', () => {
    const r = resolveOpenRecordEnd(열린기록(), 퇴근('15:00'), '22:00');
    assert.equal(r.endTime, '15:00');
    assert.equal(r.duration, 300);
    assert.equal(r.reason, 'out-time');
});

test('퇴근시각이 업무 시작보다 이르면 그 기록과 무관하다 — 쓰지 않는다', () => {
    // 09:30 퇴근인데 10:00 에 시작한 기록. 같은 사람의 다른 날 값이거나 잘못 들어간 값이다.
    const r = resolveOpenRecordEnd(열린기록(), 퇴근('09:30'), '22:00');
    assert.equal(r.endTime, AUTO_END_TIME);
    assert.equal(r.reason, 'day-end');
});

test("아직 퇴근을 안 찍은 사람(status 'active')의 outTime 은 보지 않는다", () => {
    const r = resolveOpenRecordEnd(열린기록(),
        { inTime: '09:00', outTime: '12:00', status: 'active' }, '22:00');
    assert.equal(r.endTime, AUTO_END_TIME);
});

test('★ 퇴근시각이 저장시각과 같아도 퇴근을 쓴다', () => {
    // `out < end` 로 두면 이 순간 퇴근이 탈락해 17:30 으로 떨어졌다.
    // 그 저장이 그날의 마지막이면(탭 종료·마감) 저녁 90분이 영구히 사라진다.
    const r = resolveOpenRecordEnd(열린기록(), 퇴근('19:00'), '19:00');
    assert.equal(r.endTime, '19:00');
    assert.equal(r.duration, 540);
    assert.equal(r.reason, 'out-time');
});

test('퇴근시각이 지금보다 뒤면 지금을 넘기지 않는다', () => {
    const r = resolveOpenRecordEnd(열린기록(), 퇴근('19:00'), '11:00');
    assert.equal(r.endTime, '11:00');
    assert.equal(r.reason, 'now');
});

// ── ② 증거가 없으면 업무일 종료시각을 넘기지 않는다 ──────────────

test('★ 근태 기록이 없고 22:00 에 저장 → 17:30. 22:00까지 일했다는 증거가 0이다', () => {
    const r = resolveOpenRecordEnd(열린기록(), null, '22:00');
    assert.equal(r.endTime, '17:30');
    assert.equal(r.duration, 450);
    assert.equal(r.reason, 'day-end');
});

test('업무시간 중(11:00)에는 깎지 않는다 — 진행 중인 시간은 그대로 보여야 한다', () => {
    const r = resolveOpenRecordEnd(열린기록(), null, '11:00');
    assert.equal(r.endTime, '11:00');
    assert.equal(r.duration, 60);
    assert.equal(r.reason, 'now');
});

// ── ③ 마지막 그물: 기록당 상한 ──────────────────────────────────

test('근태가 없는 새벽 기록은 상한에서 잘린다 — 끝시각도 같이 당긴다', () => {
    // 05:00 시작 → 17:30 이면 750분. 상한 720분을 넘으므로 17:00 으로 당겨 720분.
    const r = resolveOpenRecordEnd(열린기록({ startTime: '05:00' }), null, '22:00');
    assert.equal(r.duration, MAX_OPEN_RECORD_MINUTES);
    assert.equal(r.endTime, '17:00');
    assert.equal(r.reason, 'cap');
});

test('★ 상한으로 자를 때 endTime 과 duration 이 어긋나지 않는다', () => {
    // 끝시각만 두고 시간만 깎으면 화면과 숫자가 서로 다른 말을 한다.
    const r = resolveOpenRecordEnd(열린기록({ startTime: '05:00' }), 퇴근('23:00'), '23:30');
    assert.equal(r.reason, 'cap');
    assert.equal(r.duration, MAX_OPEN_RECORD_MINUTES);
    const [h, m] = r.endTime.split(':').map(Number);
    assert.equal((h * 60 + m) - (5 * 60), r.duration, '휴식이 없으면 끝-시작 = 시간');
});

test('★ 열린 휴식이 있어도 상한이 새지 않는다', () => {
    // 예전 구현은 상한을 적용할 때 휴식을 당긴 끝시각으로 **다시 닫아서**,
    // 열린 휴식이 0분으로 덮이고 780분이 그대로 통과했다.
    const r = resolveOpenRecordEnd(
        열린기록({ startTime: '09:00', status: 'paused', pauses: [{ start: '22:00' }] }),
        퇴근('23:00'), '23:30');
    assert.ok(r.duration <= MAX_OPEN_RECORD_MINUTES, `상한을 넘었다: ${r.duration}`);
    assert.equal(r.pauses[0].start, '22:00');
    assert.ok(r.pauses[0].end && r.pauses[0].end !== '22:00',
        '열린 휴식을 0분으로 덮어쓰지 않는다');
});

test('★ 상한으로 당긴 끝시각보다 뒤에 있는 휴식은 빼지 않는다', () => {
    // 00:00 시작 + 15~16시 휴식. 상한이 끝을 13:00 쪽으로 당기면 그 휴식은 범위 밖이다.
    // 예전엔 범위 밖 휴식까지 빼서 60분이 조용히 사라졌다.
    const r = resolveOpenRecordEnd(
        열린기록({ startTime: '00:00', pauses: [{ start: '15:00', end: '16:00' }] }),
        null, '22:00');
    assert.equal(r.duration, MAX_OPEN_RECORD_MINUTES);
    assert.equal(r.endTime, '12:00', '00:00 부터 쉬지 않고 720분');
});

test('★ 어떤 입력에도 상한을 넘지 않는다 (불변식)', () => {
    const 경우들 = [];
    ['00:00', '05:00', '09:00', '17:00', '19:00', '23:00'].forEach(st => {
        [null, 퇴근('15:00'), 퇴근('19:00'), 퇴근('23:50')].forEach(att => {
            ['09:00', '17:30', '20:00', '23:59'].forEach(now => {
                [[], [{ start: '12:30', end: '13:30' }], [{ start: '12:00' }],
                 [{ start: '10:00', end: '20:00' }], [{ start: '01:00', end: '02:00' },
                 { start: '01:30', end: '03:00' }]].forEach(pauses => {
                    경우들.push([st, att, now, pauses]);
                });
            });
        });
    });
    경우들.forEach(([st, att, now, pauses]) => {
        const status = pauses.some(p => !p.end) ? 'paused' : 'ongoing';
        const r = resolveOpenRecordEnd(열린기록({ startTime: st, status, pauses }), att, now);
        if (r.duration == null) return;
        assert.ok(r.duration >= 0 && r.duration <= MAX_OPEN_RECORD_MINUTES,
            `${st}/${now}/${JSON.stringify(att)} → ${r.duration}분`);
        assert.ok(r.endTime >= st || r.duration === 0, `끝(${r.endTime})이 시작(${st})보다 이르다`);
    });
    assert.equal(경우들.length, 480);
});

// ── 휴식 구간 ───────────────────────────────────────────────────

test('열린 휴식은 끝시각으로 닫고, 그 시간을 근무로 세지 않는다', () => {
    const r = resolveOpenRecordEnd(
        열린기록({ status: 'paused', pauses: [{ start: '12:00' }] }), null, '22:00');
    assert.equal(r.pauses[0].end, '17:30');
    assert.equal(r.duration, 120, '10:00~17:30 에서 12:00~17:30 휴식을 뺀 2시간');
});

test('★ end < start 인 휴식 구간을 원본에 남기지 않는다', () => {
    // 역순 구간은 계산에서는 무시되지만, 휴식시간 표시와 엑셀 출력이 그걸 그대로 들고 다닌다.
    const r = resolveOpenRecordEnd(
        열린기록({ status: 'paused', pauses: [{ start: '18:00' }] }), null, '22:00');
    assert.equal(r.pauses[0].end, '18:00', '끝시각(17:30)이 아니라 휴식 시작으로 닫는다');
    assert.ok(r.pauses[0].end >= r.pauses[0].start);
    // 그 휴식(18:00~18:00)은 끝시각 17:30 보다 뒤라 근무시간에서 빠지지 않는다.
    assert.equal(r.duration, 450, '10:00~17:30 전체가 근무다');
});

// ── 판단할 수 없는 입력 ─────────────────────────────────────────

test("★ 0채움이 아닌 시각('9:30')은 손대지 않는다 — 조용히 0분으로 만들면 기록이 사라진다", () => {
    // 호출한 쪽에 '완료인데 0분이면 버린다' 는 필터가 있다. 깨진 입력을 0분으로 만들면 그 필터에 걸린다.
    const r = resolveOpenRecordEnd(열린기록({ startTime: '9:30' }), null, '22:00');
    assert.equal(r.endTime, null);
    assert.equal(r.reason, 'invalid');

    const { records, clamped } = clampOpenRecords([열린기록({ startTime: '9:30' })], {}, '22:00');
    assert.equal(records[0].startTime, '9:30');
    assert.equal(records[0].duration, undefined, '원본에 없던 값을 만들지 않는다');
    assert.equal(clamped.length, 0);
});

test('★ 업무일 종료 뒤에 시작한 기록을 17:30 으로 당기지 않는다', () => {
    // 19:00 에 시작한 야근 업무. 17:30 으로 당기면 **0분**이 되어, 퇴근을 찍기 전에
    // 안전망이 먼저 돌면 그 야근이 통째로 사라진다. 기록이 존재한다는 것 자체가
    // '그 시각에 일하고 있었다' 는 증거다.
    const r = resolveOpenRecordEnd(열린기록({ startTime: '19:00' }), null, '20:00');
    assert.equal(r.endTime, '20:00');
    assert.equal(r.duration, 60);
    assert.equal(r.reason, 'now');

    // 퇴근을 찍었으면 당연히 그게 이긴다.
    const r2 = resolveOpenRecordEnd(열린기록({ startTime: '19:00' }), 퇴근('21:00'), '23:00');
    assert.equal(r2.endTime, '21:00');
    assert.equal(r2.duration, 120);
});

test('끝시각보다 늦게 시작한 기록은 0분이 되지만 사라지지 않는다', () => {
    // 지금(09:00)보다 뒤인 18:00 에 시작한 기록 — 깨진 데이터다. 음수를 만들지 않는다.
    const r = resolveOpenRecordEnd(열린기록({ startTime: '18:00' }), null, '09:00');
    assert.equal(r.endTime, '18:00');
    assert.equal(r.duration, 0);
    assert.equal(r.reason, 'late-start');
});

test('이미 끝난 기록은 다시 계산하지 않는다', () => {
    const r = resolveOpenRecordEnd(
        { ...열린기록(), status: 'completed', endTime: '16:00', duration: 360 }, null, '22:00');
    assert.equal(r.endTime, null);
    assert.equal(r.reason, 'not-open');
});

// ── clampOpenRecords ───────────────────────────────────────────

test('★ status 를 어떤 경우에도 completed 로 바꾸지 않는다', () => {
    // 예전 코드는 20시간을 넘기면 status 를 completed 로 바꿨다. 그러면 마감된 날
    // 덧붙이기 경로가 '완료된 기록만' 골라 접붙여, 가짜 시간이 이력에 영구히 박혔다.
    const { records } = clampOpenRecords(
        [열린기록({ startTime: '00:30' }), 열린기록({ id: 'r2', status: 'paused' })],
        {}, '23:30');
    assert.equal(records[0].status, 'ongoing');
    assert.equal(records[1].status, 'paused');
});

test('깎은 기록만 clamped 에 남긴다 — 로그에 근거를 적을 수 있어야 한다', () => {
    const { clamped } = clampOpenRecords([
        열린기록({ id: 'a', member: '멤버A' }),                      // 근태 없음 → day-end
        열린기록({ id: 'b', member: '멤버B' }),                      // 퇴근 15:00 → out-time
        { id: 'c', member: '멤버C', startTime: '10:00', status: 'completed', duration: 300 },
    ], { '멤버B': 퇴근('15:00') }, '22:00');

    assert.deepEqual(clamped.map(c => [c.id, c.reason]), [['a', 'day-end'], ['b', 'out-time']]);
    assert.equal(clamped[0].end, '17:30');
    assert.equal(clamped[0].start, '10:00', '로그에 시작시각이 있어야 당긴 폭을 읽을 수 있다');
    assert.equal(clamped[1].minutes, 300);
});

test('업무시간 중 저장이면 clamped 가 비어 있다 — 평소에 경고가 쌓이지 않는다', () => {
    const { clamped } = clampOpenRecords([열린기록(), 열린기록({ id: 'r2' })], {}, '11:00');
    assert.equal(clamped.length, 0);
});

test('원본 배열과 기록 객체를 바꾸지 않는다', () => {
    const 원본 = [열린기록({ status: 'paused', pauses: [{ start: '12:00' }] })];
    const 사본 = JSON.parse(JSON.stringify(원본));
    clampOpenRecords(원본, {}, '22:00');
    assert.deepEqual(원본, 사본);
});

test('기록이 없거나 입력이 이상해도 던지지 않는다', () => {
    assert.deepEqual(clampOpenRecords(null, null, '22:00'), { records: [], clamped: [] });
    assert.deepEqual(clampOpenRecords([], {}, 'x').records, []);
    const { records } = clampOpenRecords([열린기록()], {}, '밤중');
    assert.equal(records[0].duration, undefined, '지금 시각이 깨졌으면 아무것도 안 한다');
});

// ── 마감 경로와 규칙이 같은가 ───────────────────────────────────
//
// ⚠️ 한계를 밝혀 둔다. `previewDayClose` 는 history-data-manager.js 에 있고 그 파일은
//    Firebase 를 https URL 로 import 하므로 node 가 읽을 수 없다. 그래서 아래 `마감규칙`
//    은 그 함수의 열린 기록 처리(history-data-manager.js:714~737)를 **손으로 옮긴 사본**이다.
//    저쪽이 바뀌면 이 테스트는 자동으로 알려주지 못한다 — 마감 경로를 고칠 때 여기도 봐야 한다.
//    그래도 두 규칙이 같다는 사실을 글이 아니라 실행되는 코드로 남겨 둘 가치가 있다.
const 마감규칙 = (record, att, endTime) => {
    const start = record.startTime;
    let end = endTime;
    const a = att[record.member];
    if (a && a.status === 'returned' && a.outTime) {
        if (a.outTime > start) end = (a.outTime <= endTime) ? a.outTime : endTime;
    }
    if (start > end) end = start;
    const pauses = (record.pauses || []).map(p => ({ ...p }));
    if (record.status === 'paused' && pauses.length > 0) {
        const lp = pauses[pauses.length - 1];
        if (lp && !lp.end) lp.end = end;
    }
    let total = Math.max(0, (Number(end.slice(0, 2)) * 60 + Number(end.slice(3)))
                          - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))));
    pauses.forEach(p => {
        if (p.start && p.end) {
            const ps = Number(p.start.slice(0, 2)) * 60 + Number(p.start.slice(3));
            const pe = Number(p.end.slice(0, 2)) * 60 + Number(p.end.slice(3));
            if (pe > ps) total -= (pe - ps);
        }
    });
    return Math.max(0, total);
};

// ⚠️ 두 규칙이 **언제** 같은지: `nowTime === dayEnd` 이고 상한(③)에 걸리지 않고
//    퇴근시각이 `nowTime` 보다 이를 때. 그 밖에서는 일부러 다르다 —
//    마감은 사람이 고른 종료시각으로 전원을 확정하고(그래서 상한이 필요 없다),
//    이 함수는 아무도 고르지 않은 상태에서 가장 작은 defensible 값을 쓴다.
test('★ 17:30 에 저장하면 사람이 누른 마감과 같은 숫자가 나온다', () => {
    const 근태 = { '멤버A': 퇴근('15:00'), '멤버B': 퇴근('17:20'), '멤버C': 퇴근('09:30') };
    const 기록들 = [
        열린기록({ id: 'a', member: '멤버A' }),
        열린기록({ id: 'b', member: '멤버B', status: 'paused', pauses: [{ start: '12:00' }] }),
        열린기록({ id: 'c', member: '멤버C' }),
        열린기록({ id: 'd', member: '멤버D' }),                        // 근태 없음
        열린기록({ id: 'e', member: '멤버E', startTime: '17:40' }),     // 늦게 시작
    ];
    const { records } = clampOpenRecords(기록들, 근태, AUTO_END_TIME);
    records.forEach((r, i) => {
        assert.equal(r.duration, 마감규칙(기록들[i], 근태, AUTO_END_TIME),
            `${r.id}: 마감 경로와 다른 숫자가 나왔다`);
    });
});
