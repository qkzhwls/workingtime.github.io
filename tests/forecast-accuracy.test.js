// tests/forecast-accuracy.test.js — 정확도 오차 분해 단위 테스트
// 실행:  npm test   (= node --test)
//
// 이 테스트의 목적은 두 가지다.
//   ① 새 지표(계획 적중·계획 외 유입·미착수)가 맞는지
//   ② 기존 hourErr 가 **바뀌지 않았는지** — 옛 날짜 9일치 숫자가 흔들리면 안 된다
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeAccuracy, summarizeAccuracyRows } from '../js/forecast-accuracy.js?v=202610021042';

/** duration 은 '분'. 한 업무에 여러 건이 들어오는 게 정상이다(사람·분할). */
const rec = (task, min, member = 'A') => ({ task, duration: min, member });
const 근 = (v, d = 6) => Number(v.toFixed(d));

test('정상 혼합일 — 계획 2건 수행 + 계획 외 1건', () => {
    const snap = {
        tasks: { 직진배송: 1000 },
        timeTasks: { 상품검수: { minutes: 120, workers: 2 } },
        uph: { 직진배송: 125 },       // 계획 8h
        totalHours: 10               // 8h + 2h
    };
    const day = {
        id: '2026-09-15',
        taskQuantities: { 직진배송: 900 },
        workRecords: [rec('직진배송', 7 * 60), rec('상품검수', 150), rec('회의', 60)]
    };
    const r = decomposeAccuracy(snap, day);

    assert.equal(근(r.actualPlannedHours), 7 + 2.5);     // 9.5h
    assert.equal(근(r.unplannedHours), 1);               // 회의
    assert.equal(근(r.actualHours), 10.5);
    assert.equal(근(r.planPlannedHours), 10);
    assert.equal(근(r.planHitErr), 근(-0.05));           // (9.5-10)/10
    assert.equal(근(r.unplannedShare), 근(1 / 10.5));
    assert.equal(r.missed.count, 0);
    // 기존 수식: 계획 10 + 계획외 1 = 11 분모
    assert.equal(근(r.planHours), 11);
    assert.equal(근(r.hourErr), 근((10.5 - 11) / 11));
});

test('2026-09-28 완전 미착수 재현 — 기존 오차는 양호한데 계획 적중은 -100%', () => {
    const snap = {
        tasks: { 직진배송: 936, 채우기: 204 },
        timeTasks: { 에이블리배송: { minutes: 90, workers: 1 } },
        uph: { 직진배송: 120, 채우기: 68 },
        totalHours: 936 / 120 + 204 / 68 + 1.5      // 7.8 + 3 + 1.5 = 12.3
    };
    // 계획·실적은 둘 다 '인시'(사람×시간)다. 그날 팀 전체가 계획 외 업무에 붙었으므로
    // 계획 외 시간이 10명 하루치 규모(≈82인시)로 잡힌다 — 이게 분모를 채워 오차를 가린다.
    const day = {
        id: '2026-09-28',
        taskQuantities: {},                          // 실적 물량 없음
        workRecords: [
            ...Array.from({ length: 10 }, (_, i) => rec('반품정리', 300, 'M' + i)),   // 50인시
            ...Array.from({ length: 8 }, (_, i) => rec('로케이션정리', 240, 'N' + i))  // 32인시
        ]
    };
    const r = decomposeAccuracy(snap, day);

    assert.equal(근(r.planHitErr), -1, '계획한 업무를 하나도 안 했으므로 -100%');
    assert.equal(r.missed.count, 3);
    assert.deepEqual(r.missed.keys, ['직진배송', '채우기', '에이블리배송'].sort());
    assert.equal(근(r.missed.share), 1, '계획 시간 전부가 미착수');
    assert.equal(근(r.unplannedShare), 1, '실제 시간 전부가 계획 외');

    // ★ 하위호환 — 기존 hourErr 는 분모가 계획외로 채워져 '양호'하게 보인다.
    //   이 값이 바뀌면 옛 날짜 숫자가 흔들린 것이다.
    const 계획외 = 50 + 32;                       // 82인시
    const 기존분모 = 12.3 + 계획외;
    assert.equal(근(r.hourErr), 근((계획외 - 기존분모) / 기존분모));
    assert.ok(r.hourErr > -0.14 && r.hourErr < -0.12,
        '기존 지표는 -13% 근방 = 계획이 통째로 틀린 날이 양호하게 보이는 증거');
    assert.ok(Math.abs(r.hourErr) < Math.abs(r.planHitErr) / 5,
        '같은 날인데 기존 지표가 새 지표보다 5배 이상 관대하다 — 이것이 고치려는 것');
});

test('계획이 0인 날 — planHitErr·missed.share 는 null, throw 없음', () => {
    const snap = { tasks: { 직진배송: 0 }, timeTasks: {}, uph: {}, totalHours: 0 };
    const day = { id: '2026-09-20', taskQuantities: {}, workRecords: [rec('정리', 120)] };
    const r = decomposeAccuracy(snap, day);

    assert.equal(r.planHitErr, null);
    assert.equal(r.missed.share, null);
    assert.equal(r.missed.count, 0);
    assert.equal(근(r.unplannedShare), 1);
    // 기존 수식은 계획 외 시간을 계획으로 삼으므로 '오차 0%'(완벽)로 읽힌다.
    // 계획이 아예 없던 날조차 양호하게 보이는 것 — 이것도 같은 결함이다.
    assert.equal(r.hourErr, 0);
});

test('실적이 아예 없는 날 — unplannedShare 는 null, planHitErr 는 -100%', () => {
    const snap = { tasks: { 직진배송: 500 }, timeTasks: {}, uph: { 직진배송: 100 }, totalHours: 5 };
    const day = { id: '2026-09-21', taskQuantities: {}, workRecords: [] };
    const r = decomposeAccuracy(snap, day);

    assert.equal(r.unplannedShare, null);
    assert.equal(근(r.planHitErr), -1);
    assert.equal(r.missed.count, 1);
    assert.equal(근(r.hourErr), -1);
});

test('미착수 판정의 비대칭 — 수량형은 물량이 입력돼 있으면 미착수가 아니다', () => {
    const snap = { tasks: { 직진배송: 500 }, timeTasks: {}, uph: { 직진배송: 100 }, totalHours: 5 };

    // 시간 기록은 없지만 처리량이 들어가 있다 → 했는데 기록을 안 누른 것. 미착수 아님.
    const a = decomposeAccuracy(snap, { id: 'd', taskQuantities: { 직진배송: 480 }, workRecords: [] });
    assert.equal(a.missed.count, 0);

    // 처리량도 없다 → 미착수
    const b = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });
    assert.equal(b.missed.count, 1);

    // 시간형은 taskQuantities 와 무관하게 시간 0 이면 미착수
    const snapT = { tasks: {}, timeTasks: { 검수: { minutes: 120, workers: 2 } }, uph: {}, totalHours: 2 };
    const c = decomposeAccuracy(snapT, { id: 'd', taskQuantities: { 검수: 999 }, workRecords: [] });
    assert.equal(c.missed.count, 1);
    assert.deepEqual(c.missed.keys, ['검수']);
});

test('기준 UPH 가 없는 수량형 — 미착수에서 빼고 noBaselineKeys 로 드러낸다', () => {
    const snap = {
        tasks: { 직진배송: 500, 신규업무: 300 },
        timeTasks: {}, uph: { 직진배송: 100 },       // 신규업무 UPH 없음
        totalHours: 5
    };
    const r = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });

    assert.deepEqual(r.noBaselineKeys, ['신규업무']);
    assert.equal(r.planHoursByTask['신규업무'], 0);
    assert.equal(r.missed.count, 1, '판정 불가한 업무를 미착수로 세지 않는다');
    assert.deepEqual(r.missed.keys, ['직진배송']);
});

test('시간형 인원 0명 = 그날 안 하는 업무 → 계획 시간 0, 미착수 아님', () => {
    const snap = {
        tasks: {}, timeTasks: { 상품검수: { minutes: 180, workers: 0 } },
        uph: {}, totalHours: 0
    };
    const r = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });

    assert.equal(r.planHoursByTask['상품검수'], 0);
    assert.equal(r.missed.count, 0, 'simulateOneDay 과 같은 규칙 — 0명이면 시간도 0');
});

test('옛 스키마 하위호환 — uph·timeTasks 가 없는 스냅샷도 깨지지 않는다', () => {
    const snap = { tasks: { 직진배송: 800 }, totalHours: 7 };   // uph·timeTasks 없음
    const day = { id: '2026-09-08', taskQuantities: { 직진배송: 700 }, workRecords: [rec('직진배송', 400)] };
    const r = decomposeAccuracy(snap, day);

    assert.equal(근(r.planHours), 7);
    assert.equal(근(r.hourErr), 근((400 / 60 - 7) / 7));
    assert.equal(근(r.planHitErr), 근((400 / 60 - 7) / 7));
    assert.equal(r.missed.count, 0);
    assert.deepEqual(r.noBaselineKeys, ['직진배송']);
});

test('쓰레기 입력 — null·음수·문자열·workRecords 없음에도 throw 하지 않는다', () => {
    const snap = { tasks: { A: 100, B: '어' }, timeTasks: { C: { minutes: null } }, uph: { A: 50 }, totalHours: 2 };
    const day = {
        id: 'd', taskQuantities: null,
        workRecords: [rec('A', null), rec('A', -5), rec('A', '30'), { duration: 60 }, rec('Z', 60)]
    };
    const r = decomposeAccuracy(snap, day);
    // 업무명 없는 기록(60분)도 '실제 시간'에는 들어간다 — 종전 spentMin 합계와 같은 값이어야 한다
    assert.equal(근(r.actualHours), 2.5);
    assert.equal(근(r.untaggedHours), 1, '업무명이 없어 어느 쪽으로도 배분할 수 없는 시간');
    assert.equal(근(r.actualPlannedHours), 0.5);
    assert.equal(근(r.unplannedHours), 1);
    assert.equal(근(r.actualPlannedHours + r.unplannedHours + r.untaggedHours), 근(r.actualHours));

    assert.doesNotThrow(() => decomposeAccuracy(null, null));
    const empty = decomposeAccuracy(null, null);
    assert.equal(empty.hourErr, null);
    assert.equal(empty.missed.count, 0);
});

test('같은 업무 기록 여러 건은 합산된다', () => {
    const snap = { tasks: { 직진배송: 600 }, timeTasks: {}, uph: { 직진배송: 100 }, totalHours: 6 };
    const day = {
        id: 'd', taskQuantities: { 직진배송: 600 },
        workRecords: [rec('직진배송', 120, 'A'), rec('직진배송', 120, 'B'), rec('직진배송', 120, 'C')]
    };
    const r = decomposeAccuracy(snap, day);
    assert.equal(근(r.actualPlannedHours), 6);
    assert.equal(r.planHitErr, 0);
});

test('summarizeAccuracyRows: 빈 배열 → 전부 null', () => {
    const s = summarizeAccuracyRows([]);
    assert.equal(s.days, 0);
    assert.equal(s.avgPlanHitErr, null);
    assert.equal(s.avgAbsPlanHitErr, null);
    assert.equal(s.avgUnplannedShare, null);
    assert.equal(s.missedDays, 0);
    assert.deepEqual(summarizeAccuracyRows(null).days, 0);
});

test('summarizeAccuracyRows: null 인 행은 평균 분모에서 빠진다', () => {
    const rows = [
        { planHitErr: -0.2, unplannedShare: 0.1, hourErr: -0.1, missed: { count: 1, planHours: 2 } },
        { planHitErr: null, unplannedShare: null, hourErr: null, missed: { count: 0, planHours: 0 } },
        { planHitErr: 0.4, unplannedShare: 0.3, hourErr: 0.2, missed: { count: 2, planHours: 3 } }
    ];
    const s = summarizeAccuracyRows(rows);
    assert.equal(s.days, 3);
    assert.equal(근(s.avgPlanHitErr), 근(0.1));          // (-0.2+0.4)/2
    assert.equal(근(s.avgAbsPlanHitErr), 근(0.3));       // (0.2+0.4)/2
    assert.equal(근(s.avgUnplannedShare), 근(0.2));
    assert.equal(s.missedDays, 2);
    assert.equal(s.missedTaskTotal, 3);
    assert.equal(근(s.missedHoursTotal), 5);
});

test('summarizeAccuracyRows: 자동·수동 날 수가 합계와 맞는다', () => {
    const rows = [{ auto: true, missed: {} }, { auto: false, missed: {} }, { missed: {} }];
    const s = summarizeAccuracyRows(rows);
    assert.equal(s.autoDays, 1);
    assert.equal(s.manualDays, 2);
    assert.equal(s.autoDays + s.manualDays, s.days);
});

test('★ 전체 오차는 종전 수식과 완전히 같다 — 업무명 없는 기록이 섞인 날', () => {
    // 종전 수식:  actualHours = 모든 duration 합 / 60
    //             planHours   = snap.totalHours + (계획에 없는 '업무명 있는' 기록 시간)
    // 업무명 없는 기록은 분자에만 들어가고 분모에는 안 들어간다. 그 비대칭까지 같아야 한다.
    const snap = { tasks: { A: 500 }, timeTasks: {}, uph: { A: 100 }, totalHours: 5 };
    const day = {
        id: 'd', taskQuantities: { A: 500 },
        workRecords: [rec('A', 240), rec('Z', 120), { duration: 90 }]
    };
    const r = decomposeAccuracy(snap, day);

    const 종전_실제 = (240 + 120 + 90) / 60;          // 7.5
    const 종전_계획 = 5 + 120 / 60;                   // 7
    assert.equal(근(r.actualHours), 근(종전_실제));
    assert.equal(근(r.planHours), 근(종전_계획));
    assert.equal(근(r.hourErr), 근((종전_실제 - 종전_계획) / 종전_계획));
});

test('missed.share 는 100% 를 넘지 않는다 (uph 반올림 때문)', () => {
    // 계획 시간을 uph 로 재현하면 totalHours 보다 조금 커질 수 있다
    const snap = { tasks: { A: 1000 }, timeTasks: {}, uph: { A: 99.99 }, totalHours: 10 };
    const r = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });
    assert.ok(r.missed.planHours > 10, '재현값이 분모보다 크다');
    assert.equal(r.missed.share, 1, '그래도 100% 로 자른다');
});

test('같은 업무가 수량형·시간형 양쪽에 남은 잔재 스냅샷 — 수량형 값을 덮지 않는다', () => {
    const snap = {
        tasks: { A: 1000 },
        timeTasks: { A: { minutes: 600, workers: 5 } },   // 잔재
        uph: { A: 100 },
        totalHours: 10                                   // 수량형으로만 센 값
    };
    const r = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });
    assert.equal(근(r.planHoursByTask.A), 10, '수량형 10h 가 유지된다(시간형 10h 로 덮이지 않음)');
    assert.equal(r.missed.count, 1);
    assert.ok(r.missed.share <= 1);
});

test('summarizeAccuracyRows: noBaselineDays — 미착수 0 이 거짓 안심인 날을 센다', () => {
    const rows = [
        { missed: { count: 0 }, noBaselineKeys: ['신규업무'] },
        { missed: { count: 0 }, noBaselineKeys: [] },
        { missed: { count: 1, planHours: 2 } }                  // noBaselineKeys 없음
    ];
    const s = summarizeAccuracyRows(rows);
    assert.equal(s.noBaselineDays, 1);
    assert.equal(s.missedDays, 1);
});
