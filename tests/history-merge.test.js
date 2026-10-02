// tests/history-merge.test.js — 이력 저장에서 서버와 화면 중 무엇이 이기는가
// 실행:  npm test   (= node --test)
//
// 기대값은 전부 `saveProgress` 의 기존 인라인 로직에서 그대로 옮긴 것이다. 각 테스트에
// 어느 규칙에서 나온 기대인지 적어 둔다 — 나중에 이 테스트가 틀렸다고 느껴지면,
// 먼저 저쪽 주석을 읽을 것. 이 규칙들은 전부 **실제 사고 뒤에** 생겼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideHistoryMerge } from '../js/lib/history-merge.js?v=202610021228';

const 기록 = (id, over = {}) => ({ id, member: '멤버A', task: '국내배송',
                                   status: 'completed', duration: 300, ...over });

/** 평범한 화면 상태 */
const 화면 = (over = {}) => ({
    taskQuantities: { 국내배송: 1200 },
    confirmedZeroTasks: [],
    onLeaveMembers: [],
    partTimers: [],
    dailyAttendance: { '멤버A': { inTime: '09:00', outTime: null, status: 'active' } },
    management: {},
    inspectionList: [],
    isQuantityVerified: false,
    ...over
});

const 판정 = (over = {}) => decideHistoryMerge({
    dateStr: '2026-10-01', liveRecords: [], serverHistory: {}, live: 화면(),
    now: '18:00', ...over
});

// ── ① 마감된 날은 기록을 교체하지 않는다 ────────────────────────

test('★ 마감된 날에는 완료된 새 기록만 덧붙인다 — 서버 배열을 교체하지 않는다', () => {
    const r = 판정({
        serverHistory: { closedAt: '17:30', workRecords: [기록('s1'), 기록('s2')] },
        liveRecords: [기록('s1'), 기록('새것')],
    });
    assert.deepEqual(r.patch.workRecords.map(x => x.id), ['s1', 's2', '새것'],
        '서버 2건 + 새것 1건. 이미 있는 id 는 다시 넣지 않는다');
    assert.equal(r.notes.appendedCount, 1);
    assert.equal(r.notes.isClosedDay, true);
});

test('마감된 날에 진행 중 기록은 덧붙이지 않는다', () => {
    // endTime 이 '저장한 시각' 으로 박히고, 그 뒤엔 '이미 있는 id' 라 영원히 갱신되지 않는다.
    const r = 판정({
        serverHistory: { closedAt: '17:30', workRecords: [기록('s1')] },
        liveRecords: [기록('열림', { status: 'ongoing' }), 기록('쉼', { status: 'paused' })],
    });
    assert.ok(!('workRecords' in r.patch), '덧붙일 게 없으면 키를 아예 뺀다');
    assert.equal(r.notes.omitRecordsKey, true);
    assert.deepEqual(r.memRecords.map(x => x.id), ['s1']);
});

test('마감된 날에 id 없는 기록은 건너뛰고 몇 건인지 센다', () => {
    const r = 판정({
        serverHistory: { closedAt: '17:30', workRecords: [기록('s1')] },
        liveRecords: [{ member: '멤버A', status: 'completed', duration: 60 }],
    });
    assert.equal(r.notes.skippedNoIdCount, 1);
    assert.ok(!('workRecords' in r.patch));
});

test('마감 안 된 날은 평소처럼 기록을 교체한다', () => {
    const r = 판정({
        serverHistory: { workRecords: [기록('s1'), 기록('s2')] },
        liveRecords: [기록('a')],
    });
    assert.deepEqual(r.patch.workRecords.map(x => x.id), ['a']);
    assert.equal(r.notes.isClosedDay, false);
});

// ── ② 마감된 날의 근태는 서버가 이긴다 ──────────────────────────

test('★ 마감된 날의 퇴근시각을, 마감 전 상태를 들고 있던 탭이 되돌리지 못한다', () => {
    // 2026-10-01 사고의 한 축. 아침부터 켜 둔 탭은 '아직 근무 중' 을 들고 있다.
    const r = 판정({
        serverHistory: {
            closedAt: '17:30',
            dailyAttendance: { '멤버A': { inTime: '09:00', outTime: '17:25', status: 'returned' } },
        },
        liveRecords: [기록('a')],
    });
    assert.equal(r.patch.dailyAttendance['멤버A'].outTime, '17:25');
    assert.equal(r.patch.dailyAttendance['멤버A'].status, 'returned');
});

test('마감된 날이라도 마감 뒤에 새로 생긴 사람은 더한다', () => {
    const r = 판정({
        live: 화면({ dailyAttendance: {
            '멤버A': { status: 'active' },
            '멤버B': { inTime: '18:00', outTime: null, status: 'active' },
        } }),
        serverHistory: {
            closedAt: '17:30',
            dailyAttendance: { '멤버A': { outTime: '17:25', status: 'returned' } },
        },
        liveRecords: [기록('a')],
    });
    assert.equal(r.patch.dailyAttendance['멤버A'].outTime, '17:25', '서버가 이긴다');
    assert.ok(r.patch.dailyAttendance['멤버B'], '새 사람은 들어온다');
});

test('마감 안 된 날은 화면의 근태가 그대로 저장된다', () => {
    const r = 판정({
        serverHistory: { dailyAttendance: { '멤버A': { outTime: '15:00', status: 'returned' } } },
        liveRecords: [기록('a')],
    });
    assert.equal(r.patch.dailyAttendance['멤버A'].status, 'active');
});

// ── ③ 기록 0건이면 키를 뺀다 (빈 배열이 아니다) ─────────────────

test('★ 살아있는 기록이 0건이면 workRecords 키를 뺀다 — 빈 배열을 넣으면 서버가 지워진다', () => {
    // merge:true 는 배열을 합치지 않고 통째로 바꾼다. 빈 배열 = 전부 삭제.
    const r = 판정({ serverHistory: { workRecords: [기록('s1'), 기록('s2')] }, liveRecords: [] });
    assert.ok(!('workRecords' in r.patch),
        'undefined 비교로는 못 잡는다 — 키 자체가 없어야 한다');
    assert.equal(r.notes.keepServerRecords, true);
    assert.deepEqual(r.memRecords.map(x => x.id), ['s1', 's2']);
});

test('기록이 0건이어도 물량·검수는 저장된다 — 저장을 중단하면 그것들이 날아간다', () => {
    const r = 판정({
        serverHistory: { workRecords: [기록('s1')] },
        liveRecords: [],
        live: 화면({ taskQuantities: { 국내배송: 900 }, inspectionList: [{ name: 'x' }] }),
    });
    assert.deepEqual(r.patch.taskQuantities, { 국내배송: 900 });
    assert.equal(r.patch.inspectionList.length, 1);
});

test('서버에도 기록이 없으면 0건을 그대로 쓴다 — 빈 날이 영원히 빈 채로 막히지 않는다', () => {
    const r = 판정({ serverHistory: {}, liveRecords: [] });
    assert.ok('workRecords' in r.patch);
    assert.deepEqual(r.patch.workRecords, []);
});

// ── ④ isQuantityVerified 는 후퇴하지 않는다 ─────────────────────

test('★ 물량 검증은 세 곳의 OR — 다른 탭이 저장해도 false 로 돌아가지 않는다', () => {
    assert.equal(판정({ isQuantityVerifiedArg: true }).patch.isQuantityVerified, true);
    assert.equal(판정({ live: 화면({ isQuantityVerified: true }) }).patch.isQuantityVerified, true);
    assert.equal(판정({ serverHistory: { isQuantityVerified: true } }).patch.isQuantityVerified, true);
    assert.equal(판정().patch.isQuantityVerified, false);
});

// ── 마감된 날 값 후퇴 방지 (keepClosed) ─────────────────────────

test('★ 마감된 날에 빈 화면이 이력의 물량을 지우지 못한다', () => {
    // 마감이 daily_data 를 초기화하므로, 마감 뒤 열린 탭의 저장은 전부 빈 값이다.
    const r = 판정({
        serverHistory: { closedAt: '17:30', workRecords: [기록('s1')],
                         taskQuantities: { 국내배송: 1200 }, inspectionList: [{ name: 'a' }],
                         confirmedZeroTasks: ['청소'], partTimers: [{ name: '알바1' }] },
        liveRecords: [기록('s1')],
        live: 화면({ taskQuantities: {}, inspectionList: [], confirmedZeroTasks: [], partTimers: [] }),
    });
    assert.deepEqual(r.patch.taskQuantities, { 국내배송: 1200 });
    assert.deepEqual(r.patch.confirmedZeroTasks, ['청소']);
    assert.equal(r.patch.partTimers.length, 1);
    assert.equal(r.patch.inspectionList.length, 1);
});

test('마감된 날이라도 화면에 값이 있으면 그 값이 이긴다 — 마감 뒤 수정이 막히지 않는다', () => {
    const r = 판정({
        serverHistory: { closedAt: '17:30', taskQuantities: { 국내배송: 1200 } },
        liveRecords: [기록('a')],
        live: 화면({ taskQuantities: { 국내배송: 1500 } }),
    });
    assert.deepEqual(r.patch.taskQuantities, { 국내배송: 1500 });
});

test('마감 안 된 날은 빈 값도 그대로 쓴다 — 지운 것이 되살아나면 안 된다', () => {
    const r = 판정({
        serverHistory: { taskQuantities: { 국내배송: 1200 } },
        liveRecords: [기록('a')],
        live: 화면({ taskQuantities: {} }),
    });
    assert.deepEqual(r.patch.taskQuantities, {});
});

test('management 는 서버 값 위에 화면 값을 얹는다 — 남이 고친 매출이 되돌아가지 않는다', () => {
    const r = 판정({
        serverHistory: { management: { 매출: 100, 재고: 50 } },
        live: 화면({ management: { 매출: 200 } }),
        liveRecords: [기록('a')],
    });
    assert.deepEqual(r.patch.management, { 매출: 200, 재고: 50 });
});

// ── ⑤ memRecords == 서버에 남는 배열 ───────────────────────────

test('★ 모든 분기에서 memRecords 가 서버에 남는 배열과 같다', () => {
    // 어긋나면 addHistoryWorkRecord·deleteHistoryWorkRecord 가 메모리 배열을 통째로
    // 서버에 쓰면서 방금 지킨 기록을 날린다. 그게 10/1 유실의 마지막 단계였다.
    const 경우들 = [
        { 이름: '평소', serverHistory: { workRecords: [기록('s1')] }, liveRecords: [기록('a')] },
        { 이름: '0건', serverHistory: { workRecords: [기록('s1')] }, liveRecords: [] },
        { 이름: '마감+덧붙임', serverHistory: { closedAt: '17:30', workRecords: [기록('s1')] },
          liveRecords: [기록('s1'), 기록('새것')] },
        { 이름: '마감+덧붙일것없음', serverHistory: { closedAt: '17:30', workRecords: [기록('s1')] },
          liveRecords: [기록('s1')] },
        { 이름: '빈날', serverHistory: {}, liveRecords: [] },
    ];
    경우들.forEach(({ 이름, ...입력 }) => {
        const r = 판정(입력);
        const 서버에남는것 = ('workRecords' in r.patch)
            ? r.patch.workRecords                              // 배열을 통째로 바꾼다
            : (입력.serverHistory.workRecords || []);          // 키가 없으면 기존 배열이 남는다
        assert.deepEqual(r.memRecords.map(x => x.id), 서버에남는것.map(x => x.id), 이름);
    });
});

// ── 실제 사고 ──────────────────────────────────────────────────

test('★ 2026-10-01 재현 — 마감된 날에 늦은 세션이 저장해도 이력이 줄지 않는다', () => {
    // 그날: 마감으로 이력 53건이 확정된 뒤, 아침부터 켜 둔 탭의 안전망이 22:12 에 저장을 돌려
    // 기록 7건이 사라지고 근무시간이 27시간 부풀었다. 늦은 탭은 46건만 들고 있었다.
    const 서버53 = Array.from({ length: 53 }, (_, i) => 기록('s' + i));
    const 늦은탭46 = Array.from({ length: 46 }, (_, i) => 기록('s' + i));
    const r = 판정({
        serverHistory: {
            closedAt: '17:25', workRecords: 서버53,
            taskQuantities: { 국내배송: 1200 },
            dailyAttendance: { '멤버A': { outTime: '17:25', status: 'returned' } },
        },
        liveRecords: 늦은탭46,
        live: 화면({ taskQuantities: {},
                     dailyAttendance: { '멤버A': { outTime: null, status: 'active' } } }),
    });
    assert.ok(!('workRecords' in r.patch), '기록 키가 payload 에 없어야 한다');
    assert.equal(r.memRecords.length, 53, '메모리도 53건이어야 한다');
    assert.deepEqual(r.patch.taskQuantities, { 국내배송: 1200 }, '물량도 후퇴하지 않는다');
    assert.equal(r.patch.dailyAttendance['멤버A'].outTime, '17:25', '퇴근시각도 지킨다');
});

// ── 기타 ───────────────────────────────────────────────────────

test('저장할 것이 아무것도 없으면 알려 준다 (호출처가 nothing 으로 되돌린다)', () => {
    assert.equal(판정({ live: 화면({ taskQuantities: {} }) }).notes.nothingToSave, true);
    assert.equal(판정({ liveRecords: [기록('a')] }).notes.nothingToSave, false);
    assert.equal(판정().notes.nothingToSave, false, '물량이 있으면 저장할 것이 있다');
});

test('★ payload 의 키 집합이 경우마다 정확히 이것뿐이다', () => {
    // 리팩터링에서 가장 값싸고 강한 단언이다. 키가 하나 늘거나 줄면 Firestore merge 가
    // 그 필드를 덮거나 남긴다 — 그게 이력이 사라지는 유일한 방식이다.
    const 공통 = ['confirmedZeroTasks', 'dailyAttendance', 'id', 'inspectionList',
                  'isQuantityVerified', 'management', 'onLeaveMembers', 'partTimers',
                  'savedAt', 'taskQuantities'];

    const 평소 = 판정({ liveRecords: [기록('a')] });
    assert.deepEqual(Object.keys(평소.patch).sort(), [...공통, 'workRecords'].sort());

    const 기록0건 = 판정({ serverHistory: { workRecords: [기록('s1')] }, liveRecords: [] });
    assert.deepEqual(Object.keys(기록0건.patch).sort(), 공통.sort(),
        'workRecords 키가 없어야 한다');

    const 마감 = 판정({ serverHistory: { closedAt: '17:30', workRecords: [기록('s1')] },
                        liveRecords: [기록('s1')] });
    assert.deepEqual(Object.keys(마감.patch).sort(), 공통.sort());
});

test('마감 안 된 날의 근태는 라이브 객체와 같은 참조가 아니다', () => {
    // 같은 참조면 이후 라이브 변경이 메모리 이력에 몰래 반영된다.
    const live = 화면();
    const r = 판정({ live, liveRecords: [기록('a')] });
    assert.notEqual(r.patch.dailyAttendance, live.dailyAttendance);
    assert.deepEqual(r.patch.dailyAttendance, live.dailyAttendance);
});

test('마감된 날 기록 0건 — 두 보호가 겹쳐도 어긋나지 않는다', () => {
    const r = 판정({
        serverHistory: { closedAt: '17:30', workRecords: [기록('s1'), 기록('s2')],
                         onLeaveMembers: [{ member: '멤버A', type: '연차' }] },
        liveRecords: [],
        live: 화면({ onLeaveMembers: [] }),
    });
    assert.ok(!('workRecords' in r.patch));
    assert.equal(r.notes.keepServerRecords, true);
    assert.equal(r.memRecords.length, 2);
    assert.equal(r.patch.onLeaveMembers.length, 1, '휴가 기록도 후퇴하지 않는다');
});

test('savedAt 은 인자로 받는다 — 함수 안에서 시계를 읽으면 테스트가 흔들린다', () => {
    assert.equal(판정({ now: '09:15' }).patch.savedAt, '09:15');
    assert.equal(판정().patch.id, '2026-10-01');
});

test('서버 이력이 아예 없어도(첫 저장) 던지지 않는다', () => {
    const r = decideHistoryMerge({ dateStr: '2026-10-02', liveRecords: [기록('a')],
                                   serverHistory: null, live: null, now: '18:00' });
    assert.deepEqual(r.patch.workRecords.map(x => x.id), ['a']);
    assert.deepEqual(r.patch.taskQuantities, {});
    assert.equal(r.patch.isQuantityVerified, false);
});
