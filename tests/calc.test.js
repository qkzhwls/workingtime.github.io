// tests/calc.test.js — 핵심 계산 로직 단위 테스트
// 실행:  node --test tests/      (또는  npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAmount, inDateRange, resolvePeriodRange, calcWorkMinutes, weekendFairness,
    outingDeductibleMinutes, earlyLeaveDeductibleMinutes,
    addWorkMinutes, LUNCH_START_MIN, LUNCH_END_MIN,
} from '../js/lib/calc.js?v=202610021042';
import { projectFinish } from '../js/forecast-progress.js?v=202610021042';

const H = (hh, mm = 0) => hh * 60 + mm; // 시:분 → 분

test('outingDeductibleMinutes: 점심(12:30~13:30) 외출은 차감 제외, 1시간까지 무차감', () => {
    // 점심 시간에 완전히 포함된 외출(12:30~13:30) → 차감 0
    assert.equal(outingDeductibleMinutes(H(12,30), H(13,30)), 0);
    // 12:00~13:00: 점심겹침 30분 제외 → 순30분, 1시간 이내 → 0
    assert.equal(outingDeductibleMinutes(H(12), H(13)), 0);
    // 11:00~14:00(180분): 점심겹침 60분 제외 → 순120분, 1시간 무차감 → 60분 차감
    assert.equal(outingDeductibleMinutes(H(11), H(14)), 60);
    // 점심과 무관한 09:00~11:00(120분): 겹침 0, 1시간 무차감 → 60분 차감
    assert.equal(outingDeductibleMinutes(H(9), H(11)), 60);
    // 종료시각 없음/역전 → 0
    assert.equal(outingDeductibleMinutes(H(10), null), 0);
    assert.equal(outingDeductibleMinutes(H(11), H(10)), 0);
});

test('earlyLeaveDeductibleMinutes: 종업(18:00)까지 빠진 시간 − 점심 겹침', () => {
    // 12:00 조퇴: 18:00까지 360분 − 점심 60분 = 300분
    assert.equal(earlyLeaveDeductibleMinutes(H(12), H(18)), 300);
    // 17:00 조퇴: 60분(점심 이후라 겹침 0)
    assert.equal(earlyLeaveDeductibleMinutes(H(17), H(18)), 60);
    // 종업 이후/미입력 → 0
    assert.equal(earlyLeaveDeductibleMinutes(H(18), H(18)), 0);
    assert.equal(earlyLeaveDeductibleMinutes(null, H(18)), 0);
});

test('parseAmount: 통화기호·콤마 제거, 빈값/플레이스홀더는 null', () => {
    assert.equal(parseAmount('1,234'), 1234);
    assert.equal(parseAmount('$ 1,000'), 1000);
    assert.equal(parseAmount('₩2,500원'), 2500);
    assert.equal(parseAmount(42), 42);
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('-'), null);
    assert.equal(parseAmount('#REF!'), null);
    assert.equal(parseAmount('abc'), null);
});

test('inDateRange: 경계 포함, 형식 불량 제외', () => {
    assert.equal(inDateRange('2026-06-05', '2026-06-01', '2026-06-10'), true);
    assert.equal(inDateRange('2026-06-01', '2026-06-01', '2026-06-10'), true); // from 포함
    assert.equal(inDateRange('2026-06-10', '2026-06-01', '2026-06-10'), true); // to 포함
    assert.equal(inDateRange('2026-05-31', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('2026-06-11', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('bad-date', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('2026-06-05', '', ''), true); // 무제한
});

test('resolvePeriodRange: 일/주/월/년 × 전·현·후 (오늘=목요일)', () => {
    const today = '2026-06-25'; // 목
    assert.deepEqual(resolvePeriodRange('day:-1', today), { from: '2026-06-24', to: '2026-06-24' });
    assert.deepEqual(resolvePeriodRange('day:0', today), { from: '2026-06-25', to: '2026-06-25' });
    assert.deepEqual(resolvePeriodRange('day:1', today), { from: '2026-06-26', to: '2026-06-26' });
    // 주 = 월~일
    assert.deepEqual(resolvePeriodRange('week:0', today), { from: '2026-06-22', to: '2026-06-28' });
    assert.deepEqual(resolvePeriodRange('week:-1', today), { from: '2026-06-15', to: '2026-06-21' });
    assert.deepEqual(resolvePeriodRange('week:1', today), { from: '2026-06-29', to: '2026-07-05' });
    // 월
    assert.deepEqual(resolvePeriodRange('month:0', today), { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(resolvePeriodRange('month:-1', today), { from: '2026-05-01', to: '2026-05-31' });
    assert.deepEqual(resolvePeriodRange('month:1', today), { from: '2026-07-01', to: '2026-07-31' });
    // 년
    assert.deepEqual(resolvePeriodRange('year:0', today), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(resolvePeriodRange('year:-1', today), { from: '2025-01-01', to: '2025-12-31' });
    // custom
    assert.deepEqual(resolvePeriodRange('custom', today, { from: '2026-01-05', to: '2026-02-10' }),
        { from: '2026-01-05', to: '2026-02-10' });
});

test('resolvePeriodRange: 월말/연말 경계', () => {
    assert.deepEqual(resolvePeriodRange('month:1', '2026-01-31'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(resolvePeriodRange('day:1', '2026-12-31'), { from: '2027-01-01', to: '2027-01-01' });
    // 윤년 2월
    assert.deepEqual(resolvePeriodRange('month:0', '2028-02-15'), { from: '2028-02-01', to: '2028-02-29' });
});

test('calcWorkMinutes: 휴식 차감, 미종료 휴식은 종료시각까지', () => {
    assert.equal(calcWorkMinutes('09:00', '11:00', []), 120);
    assert.equal(calcWorkMinutes('09:00', '12:00', [{ start: '10:00', end: '10:30' }]), 150);
    assert.equal(calcWorkMinutes('09:00', '12:00', [{ start: '11:30', end: null }]), 150); // 미종료→12:00
    assert.equal(calcWorkMinutes('', '12:00', []), 0);
    assert.equal(calcWorkMinutes('12:00', '09:00', []), 0); // 음수 방지
});

test('weekendFairness: 정원 중 관리자 1 고정 + 기본정원 3', () => {
    const dates = ['2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14']; // 4일
    // 정원 미설정 → 기본 3. 팀원 몫=2/일, 합 8. 참여 4명 → 2회
    const r1 = weekendFairness(dates, () => undefined, 4);
    assert.equal(r1.openDays, 4);
    assert.equal(r1.totalCapacity, 12);
    assert.equal(r1.teamSlots, 8);
    assert.equal(r1.adminSlots, 4);
    assert.equal(r1.recommended, 2);

    // 일부 날짜 정원 5 설정
    const caps = { '2026-06-06': 5 };
    const r2 = weekendFairness(dates, (d) => caps[d], 4);
    assert.equal(r2.totalCapacity, 5 + 3 + 3 + 3); // 14
    assert.equal(r2.teamSlots, 4 + 2 + 2 + 2);      // 10
    assert.equal(r2.recommended, Math.round(10 / 4)); // 2.5 → 3(round)? -> Math.round(2.5)=3

    // 참여 0명 가드
    const r3 = weekendFairness(dates, () => undefined, 0);
    assert.equal(r3.avg, 0);
    assert.equal(r3.recommended, 0);
});


test('addWorkMinutes: 점심(12:30~13:30)을 건너뛴 벽시계 시각', () => {
    assert.equal(LUNCH_START_MIN, H(12, 30));
    assert.equal(LUNCH_END_MIN, H(13, 30));
    const 표 = [
        // [시작, 작업분, 기대 시각, 설명]
        [H(9), 3 * 60, H(12), '점심 전에 끝나면 그대로'],
        [H(9), 210, H(12, 30), '딱 12:30 에 끝나면 점심을 더하지 않는다 (허깨비 +60 금지)'],
        [H(9), 220, H(13, 40), '점심을 지나면 60분이 밀린다'],
        [H(9), 8 * 60, H(18), '09:00 · 8시간 → 18:00'],
        [H(12, 45), 8 * 60, H(21, 30), '점심 중 시작은 남은 45분만 건너뛴다 (12:45+8h+45m)'],
        [H(14), 4 * 60, H(18), '점심 뒤에 시작하면 그대로'],
        [H(9), 0, H(9), '작업 0분이면 시작 그대로'],
        [H(9), -30, H(9), '음수는 시작 그대로'],
    ];
    for (const [시작, 작업, 기대, 설명] of 표) {
        assert.equal(addWorkMinutes(시작, 작업), 기대, 설명);
    }
    // skipLunch=false 면 점심을 무시한다 (주말·점심정지 없던 평일)
    assert.equal(addWorkMinutes(H(9), 8 * 60, { skipLunch: false }), H(17), '점심 미가산');
    assert.equal(addWorkMinutes(H(11), 4 * 60, { skipLunch: false }), H(15),
        'skipLunch=false 면 점심을 걸치더라도 그냥 더한다');
    // 이상한 점심 구간은 무시한다 (설정이 깨져도 시각이 뒤로 튀지 않게)
    assert.equal(addWorkMinutes(H(9), 4 * 60, { lunchStart: 810, lunchEnd: 750 }), H(13),
        'lunchEnd <= lunchStart 면 점심을 더하지 않는다');
    assert.equal(addWorkMinutes(H(9), 4 * 60, { lunchStart: 750, lunchEnd: 750 }), H(13),
        '길이 0 인 점심도 더하지 않는다');
});

test('projectFinish: 점심을 기준·예상 양쪽에 같이 반영한다', () => {
    const 입력 = {
        planHours: 8, spentHours: 0, activeWorkers: 1, fallbackWorkers: 3,
        nowMin: H(11), firstStartMin: H(9), dailyHours: 8, excludeMinutes: 0,
    };
    // 기존 동작 보존 — skipLunch 를 안 주면 예전 값 그대로
    const 옛 = projectFinish(입력);
    assert.equal(옛.baseFinishMin, H(17), '기본값은 기존 동작(점심 미가산)');
    assert.equal(옛.finishMin, H(19), '기본값은 기존 동작 (11:00+8h)');
    assert.equal(옛.baseLunchMin, 0, '점심을 안 더했으면 0');
    assert.equal(옛.baseLunchText, '');

    // 점심 반영 — 11:00 에 8시간 남았으면 점심을 지나므로 둘 다 60분 밀린다
    const 새 = projectFinish({ ...입력, skipLunch: true });
    assert.equal(새.baseFinishMin, H(18), '기준 종료 09:00+8h+점심 = 18:00');
    assert.equal(새.finishMin, H(20), '종료 예상도 점심을 건너뛴다 (11:00+8h+1h)');
    assert.equal(새.baseLunchMin, 60, '더해진 점심 분을 알려 준다');
    assert.equal(새.baseLunchText, '12:30~13:30');
    // ★ 한쪽만 고쳤다면 diffMin 이 60분 어긋난다. 같이 고쳤으므로 옛 값과 같아야 한다.
    assert.equal(새.diffMin, 옛.diffMin, '둘 다 밀리므로 색 판정(diffMin)은 흔들리지 않는다');

    // 점심 뒤(14:00)에는 예측이 점심을 지나지 않으므로 기준만 밀린다.
    // ★ 이게 이번 변경의 실질이다 — 오후에는 diffMin 이 예전보다 60분 관대해진다.
    const 오후 = projectFinish({ ...입력, nowMin: H(14), skipLunch: true });
    assert.equal(오후.finishMin, H(22), '점심 뒤 예측에는 점심이 안 붙는다 (14:00+8h)');
    assert.equal(오후.baseFinishMin, H(18));
    assert.equal(오후.diffMin, 4 * 60, '기준 18:00 대비 +4시간');
    const 오후옛 = projectFinish({ ...입력, nowMin: H(14) });
    assert.equal(오후옛.diffMin, 5 * 60, '예전에는 기준이 17:00 이라 +5시간이었다');
    assert.equal(오후.diffMin, 오후옛.diffMin - 60,
        '오후에는 정확히 60분 관대해진다 — 색 규칙이 바뀌는 지점');

    // 점심 뒤에 첫 업무를 시작한 날은 기준에도 점심이 붙지 않는다 (각주 분기의 근거)
    const 늦게시작 = projectFinish({ ...입력, firstStartMin: H(14), nowMin: H(15), skipLunch: true });
    assert.equal(늦게시작.baseLunchMin, 0, '점심 뒤 시작이면 더해진 점심이 0');
    assert.equal(늦게시작.baseLunchText, '', '더한 점심이 없으면 구간 문구도 비운다');
    assert.equal(늦게시작.baseFinishMin, H(22), '14:00 + 8h');

    // 점심 중에 첫 업무를 시작한 날은 45분만, 구간 문구도 12:45~13:30
    const 점심중시작 = projectFinish({ ...입력, firstStartMin: H(12, 45), nowMin: H(14), skipLunch: true });
    assert.equal(점심중시작.baseLunchMin, 45, '남은 점심 45분만 더한다');
    assert.equal(점심중시작.baseLunchText, '12:45~13:30', '실제로 건너뛴 구간을 보여 준다');
});
