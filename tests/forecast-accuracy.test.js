// tests/forecast-accuracy.test.js — 정확도 오차 분해 단위 테스트
// 실행:  npm test   (= node --test)
//
// 이 테스트의 목적은 두 가지다.
//   ① 새 지표(계획 적중·계획 외 유입·미착수)가 맞는지
//   ② 기존 hourErr 가 **바뀌지 않았는지** — 옛 날짜 9일치 숫자가 흔들리면 안 된다
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeAccuracy, summarizeAccuracyRows, aggregateByTask } from '../js/forecast-accuracy.js?v=202610021122';

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

test('업무별 시간 비교에 필요한 값을 돌려준다 (시간형 업무 포함)', () => {
    const snap = {
        tasks: { 직진배송: 1000 },
        timeTasks: { '중국제작(담당)': { minutes: 180, workers: 2 } },
        uph: { 직진배송: 125 },      // 계획 8h
        totalHours: 11               // 8h + 3h
    };
    const day = {
        id: 'd', taskQuantities: { 직진배송: 1000 },
        workRecords: [rec('직진배송', 10 * 60), rec('중국제작(담당)', 300)]
    };
    const r = decomposeAccuracy(snap, day);

    // 업무별 계획 시간 — 수량형은 물량÷그날 얼린 UPH, 시간형은 투입시간 그대로
    assert.equal(근(r.planHoursByTask['직진배송']), 8);
    assert.equal(근(r.planHoursByTask['중국제작(담당)']), 3);
    // 업무별 실제 시간
    assert.equal(근(r.actualHoursByTask['직진배송']), 10);
    assert.equal(근(r.actualHoursByTask['중국제작(담당)']), 5);
    // 시간형 업무 키 — 물량 비교가 불가능한 업무를 화면이 구분할 수 있어야 한다
    assert.deepEqual(r.timeKeys, ['중국제작(담당)']);

    // ★ 물량은 정확히 맞혔는데(1000/1000) 시간은 2시간 더 걸렸다 — 이게 안 보이던 경우다
    assert.equal(r.planHoursByTask['직진배송'] < r.actualHoursByTask['직진배송'], true);
    assert.equal(근((10 - 8) / 8), 0.25);
});

test('timeKeys 는 옛 스냅샷(timeTasks 없음)에서도 빈 배열이다', () => {
    const r = decomposeAccuracy({ tasks: { A: 100 }, totalHours: 2 }, { id: 'd', workRecords: [] });
    assert.deepEqual(r.timeKeys, []);
    assert.deepEqual(r.actualHoursByTask, {});
});

test('plannedKeys — 기준 UPH 가 없어 계획 시간이 0 이어도 "계획에 있었다" 는 유지된다', () => {
    // 이걸 planHoursByTask 로 판정하면, 계획된 업무가 화면에서 '계획 외' 로 찍힌다
    const snap = {
        tasks: { 신규업무: 500, 직진배송: 1000 },
        timeTasks: { 검수: { minutes: 120, workers: 1 } },
        uph: { 직진배송: 100 },          // 신규업무는 기준 없음
        totalHours: 10
    };
    const r = decomposeAccuracy(snap, { id: 'd', taskQuantities: {}, workRecords: [] });

    assert.deepEqual(r.plannedKeys.sort(), ['검수', '신규업무', '직진배송'].sort());
    assert.equal(r.planHoursByTask['신규업무'], 0, '계획 시간은 못 낸다');
    assert.deepEqual(r.noBaselineKeys, ['신규업무'], '기준이 없다고 따로 알려 준다');
    // 둘을 섞으면 안 된다 — '계획에 있었다' 와 '계획 시간을 낼 수 있다' 는 다른 질문이다
    assert.ok(r.plannedKeys.includes('신규업무'));
});

test('plannedKeys 는 계획 물량이 0 인 업무를 포함하지 않는다', () => {
    const r = decomposeAccuracy(
        { tasks: { A: 0, B: 300 }, timeTasks: { C: { minutes: 0, workers: 2 } },
          uph: { B: 100 }, totalHours: 3 },
        { id: 'd', workRecords: [] });
    assert.deepEqual(r.plannedKeys, ['B'], '물량 0·시간 0 은 그날 계획이 아니다');
});

// ── aggregateByTask — 분자·분모의 날짜 집합이 어긋나는 버그가 두 번 났던 자리 ──
const 행 = (o = {}) => ({
    qty: {}, planHoursByTask: {}, actualHoursByTask: {},
    plannedKeys: [], noBaselineKeys: [], ...o
});

test('★ 기준 UPH 가 없던 날은 물량·시간을 **모두** 빼고 센다 (UPH 가 뻥튀기되지 않는다)', () => {
    // 같은 업무를 이틀, 둘 다 1000개를 2시간에 했다. 진짜 속도는 500 UPH.
    // 둘째 날만 기준 UPH 가 없다(신규 업무라 표본 부족).
    const rows = [
        행({ qty: { K: { plan: 1000, actual: 1000 } }, plannedKeys: ['K'],
             planHoursByTask: { K: 2 }, actualHoursByTask: { K: 2 } }),
        행({ qty: { K: { plan: 1000, actual: 1000 } }, plannedKeys: ['K'],
             noBaselineKeys: ['K'],
             planHoursByTask: { K: 0 }, actualHoursByTask: { K: 2 } })
    ];
    const [k] = aggregateByTask(rows);

    assert.equal(k.plan, 1000, '기준 없던 날의 물량은 빼야 한다');
    assert.equal(k.actual, 1000);
    assert.equal(근(k.planHours), 2);
    assert.equal(근(k.actualHours), 2);
    assert.equal(k.noBaseDays, 1);
    assert.equal(근(k.noBaseActualHours), 2, '뺀 실제 시간은 따로 남겨 화면이 알릴 수 있게');
    // ★ 두 UPH 모두 진값 — 예전에는 계획 1000, 실제 1000 으로 둘 다 2배가 나왔다
    assert.equal(근(k.planUPH), 500);
    assert.equal(근(k.realUPH), 500);
    assert.equal(k.uphErr, 0);
    assert.equal(k.hourErr, 0, '시간 오차도 0 — 예전에는 +100% 로 떴다');
});

test('계획에 있었으면 계획 시간이 0 이어도 "계획 외" 가 아니다', () => {
    const rows = [행({
        qty: { 신규: { plan: 500, actual: 400 } },
        plannedKeys: ['신규'], noBaselineKeys: ['신규'],
        planHoursByTask: { 신규: 0 }, actualHoursByTask: { 신규: 3 }
    })];
    const [t] = aggregateByTask(rows);
    assert.equal(t.wasPlanned, true);
    assert.equal(t.unplanned, false, '기준이 없었을 뿐 계획은 있었다');
    assert.equal(t.noBaseDays, 1);
});

test('계획에 없이 실제로만 한 업무는 계획 외로 잡고 뒤로 보낸다', () => {
    const rows = [행({
        qty: { 직진배송: { plan: 1000, actual: 900 } },
        plannedKeys: ['직진배송'],
        planHoursByTask: { 직진배송: 8 },
        actualHoursByTask: { 직진배송: 12, 잡일: 6 }   // 잡일은 계획에 없다
    })];
    const out = aggregateByTask(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].key, '직진배송', '계획 업무가 먼저');
    assert.equal(out[1].key, '잡일');
    assert.equal(out[1].unplanned, true);
    assert.equal(out[1].isTime, true, '물량이 없으니 수량 칸은 — 로 그린다');
    assert.equal(out[1].hourErr, null, '계획이 없으니 오차를 낼 수 없다');
});

test('정렬 — 계획 업무는 시간 오차 큰 순, 계획 외는 뒤에서 실제 시간 큰 순', () => {
    const rows = [행({
        qty: { A: { plan: 100, actual: 100 }, B: { plan: 100, actual: 100 } },
        plannedKeys: ['A', 'B'],
        planHoursByTask: { A: 10, B: 10 },
        // A +10% · B +90% · 잡일1 2h · 잡일2 5h
        actualHoursByTask: { A: 11, B: 19, 잡일1: 2, 잡일2: 5 }
    })];
    assert.deepEqual(aggregateByTask(rows).map(t => t.key), ['B', 'A', '잡일2', '잡일1']);
});

test('시간형 업무도 한 행으로 들어온다 (물량 칸은 비운다)', () => {
    const rows = [행({
        plannedKeys: ['개인담당업무'],
        planHoursByTask: { 개인담당업무: 11 },
        actualHoursByTask: { 개인담당업무: 9 }
    })];
    const [t] = aggregateByTask(rows);
    assert.equal(t.isTime, true);
    assert.equal(t.hasQty, false);
    assert.equal(t.err, null);
    assert.equal(t.realUPH, null, '물량이 없으니 UPH 를 내지 않는다(예전엔 0.0 이 떴다)');
    assert.equal(t.planUPH, null);
    assert.equal(근(t.hourErr), 근((9 - 11) / 11));
});

test('aggregateByTask: 빈 입력·쓰레기에도 throw 하지 않는다', () => {
    assert.deepEqual(aggregateByTask([]), []);
    assert.deepEqual(aggregateByTask(null), []);
    assert.doesNotThrow(() => aggregateByTask([null, undefined, {}]));
    assert.deepEqual(aggregateByTask([{}]), []);
});

test('★ 그날 계획에 없던 날의 실적은 계획 통에 섞지 않는다', () => {
    // 4일은 계획 8h / 실제 8h 로 완벽히 맞혔고, 5일째는 계획에 없는데 6h 했다.
    // 섞으면 32h vs 38h = +19% 로, 한 번도 안 어긴 업무가 빨갛게 뜬다.
    const 맞힌날 = () => 행({
        qty: { 직진배송: { plan: 1000, actual: 1000 } },
        plannedKeys: ['직진배송'],
        planHoursByTask: { 직진배송: 8 }, actualHoursByTask: { 직진배송: 8 }
    });
    const 계획없던날 = 행({
        qty: { 직진배송: { plan: 0, actual: 700 } },
        plannedKeys: [],                       // 그날은 계획에 없었다
        planHoursByTask: {}, actualHoursByTask: { 직진배송: 6 }
    });
    const [t] = aggregateByTask([맞힌날(), 맞힌날(), 맞힌날(), 맞힌날(), 계획없던날]);

    assert.equal(근(t.planHours), 32);
    assert.equal(근(t.actualHours), 32, '계획에 없던 날의 6h 는 빠진다');
    assert.equal(t.hourErr, 0, '★ 한 번도 안 어겼으므로 0% 여야 한다');
    assert.equal(근(t.offPlanHours), 6, '뺀 시간은 따로 남겨 화면이 알릴 수 있게');
    assert.equal(t.offPlanQty, 700);
    assert.equal(t.wasPlanned, true);
    assert.equal(t.unplanned, false, '계획에 있던 날이 있으므로 계획 외 업무가 아니다');
    // UPH 도 같은 날짜 집합 — 4000개 ÷ 32h = 125
    assert.equal(근(t.realUPH), 125);
    assert.equal(근(t.planUPH), 125);
    assert.equal(t.uphErr, 0);
});

test('계획 외 전용 업무는 계획 외 값으로 숫자를 보여 준다', () => {
    const rows = [행({
        qty: { 잡일: { plan: 0, actual: 300 } },
        plannedKeys: [],
        actualHoursByTask: { 잡일: 5 }
    })];
    const [t] = aggregateByTask(rows);
    assert.equal(t.unplanned, true);
    assert.equal(t.showQty, 300, '계획 쪽 통은 비어 있으므로 계획 외 값을 보여 준다');
    assert.equal(근(t.showHours), 5);
    assert.equal(근(t.realUPH), 60, '300 ÷ 5h');
    assert.equal(t.planUPH, null);
    assert.equal(t.hourErr, null);
});
