// === js/ui-history-staffing.js ===
import * as State from './state.js?v=202610021228';
import { dailyTaskStats, taskSpeedPerMinute } from './task-throughput.js?v=202610021228';
import { getStaffingOutlook } from './ui-history-prediction.js?v=202610021228';
import { fetchPlannedData } from './history-data-manager.js?v=202610021228';
import { getTodayDateString } from './utils.js?v=202610021228';
import { attendedMembers, presenceStats, isAttendanceEstimated, systemAccountSet, validMemberNames } from './attendance-stats.js?v=202610021228';

let staffingChartInstance = null;

// 수요 바스켓 — 출고성 + 채우기.
//
// ⚠️ 2026.09 부터 이 목록은 '필요 인원 계산'에 쓰지 않는다.
//    예전엔 이 목록의 물량만 수요로 잡았는데, 분모(작업시간)에는 검수·교환반품·재작업이
//    전부 들어가 있어 필요 인원이 구조적으로 낮게 나왔다. 지금은 모든 업무를 순회한다.
//    이 목록은 해설 문구에서 '출고성 업무'를 구분해 보여 주는 용도로만 남는다.
const DEFAULT_STAFFING_TASKS = [
    '국내배송', '중국제작', '직진배송', '에이블리배송', '해외배송', '택배포장', '티니', '채우기'
];

/** 해설 문구용 출고성 업무 목록. 설정에 목록이 있으면 그걸 쓰고, 없으면 기본값. */
const staffingBasketOf = (appConfig) => {
    const custom = appConfig && appConfig.staffingBasketTasks;
    const list = (Array.isArray(custom) && custom.length > 0) ? custom : DEFAULT_STAFFING_TASKS;
    return new Set(list.map(t => String(t).trim()).filter(Boolean));
};

/** 평상시 기준 속도(개/분). 전체 이력에서 뽑으므로 선택 기간과 무관하다 — 순환을 끊는 핵심.
 *  ※ minMinutes 는 mode:'total' 에서 무시되므로(task-throughput.js) 넘기지 않는다. */
const baselineSpeeds = () => taskSpeedPerMinute(State.allHistoryData, {
    mode: 'total',
    skipDate: getTodayDateString()   // 오늘은 물량이 덜 차 속도가 튄다
});

/** 가동률 정규화. 0.8 도 80 도 받아 준다. 이상값이면 기본 0.8. */
function normalizedUtilization(appConfig) {
    let u = Number(appConfig && appConfig.utilizationRate);
    if (!isFinite(u) || u <= 0) return 0.8;
    if (u > 1) u = u / 100;                 // 80(%) 으로 저장된 경우
    return (u > 0 && u <= 1) ? u : 0.8;
}

/** 인원으로 셀 이름인지 — 시스템계정·명부 밖 이름을 거른다(출근 인원과 같은 기준). */
function countableMembersOf(day, appConfig) {
    const system = systemAccountSet(appConfig);
    const valid = validMemberNames(day, appConfig);
    return (name) => {
        const n = name == null ? '' : String(name).trim();
        return n !== '' && !system.has(n) && valid.has(n);
    };
}

/** textContent 안전 세팅 — HTML 조각 로드 실패로 요소가 없어도 뒤 코드가 죽지 않게. */
const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
};

/** 그날 수요(분). 기준 속도가 있는 업무는 물량으로 환산하고, 없으면 실제 투입시간을 그대로 쓴다. */
function demandMinutesOf(day, speeds) {
    const stats = dailyTaskStats(day);
    let total = 0;
    Object.entries(stats).forEach(([task, s]) => {
        const spd = Number(speeds[task]) || 0;
        const qty = Number(s.qty) || 0;
        const min = Number(s.minutes) || 0;
        // 물량이 잡히고 기준 속도를 아는 업무 → 물량 ÷ 속도.
        // 그 외(검수·교환반품처럼 물량 개념이 약한 업무) → 실제 쓴 시간을 수요로 인정.
        total += (qty > 0 && spd > 0) ? (qty / spd) : min;
    });
    return total;
}

export function renderStaffingTab(filteredData, appConfig) {
    // 앞날 전망은 선택 기간과 무관하다(예정 물량 기반) — 위쪽 분석이 비어도 그린다.
    renderStaffingOutlook();
    // 예정 물량이 아직 안 실렸으면 불러온 뒤 한 번 더 (대부분 캐시라 즉시)
    fetchPlannedData().then(() => renderStaffingOutlook()).catch(() => {});

    // 값을 안 지우면 직전 기간 숫자·도넛·시뮬레이터 결과가 그대로 남아 이 기간 값으로 오독된다.
    const clearStaffingCard = (message) => {
        ['staff-actual', 'staff-worked', 'staff-required'].forEach(id => setText(id, '— 명 / 일'));
        setText('staff-total-loss', '0');
        const el = document.getElementById('staff-fte-comment');
        if (el) el.innerHTML = message;
        const sim = document.getElementById('staffing-sim-result');
        if (sim) sim.innerHTML = '';
        if (staffingChartInstance) { staffingChartInstance.destroy(); staffingChartInstance = null; }
    };

    if (!filteredData || filteredData.length === 0) {
        clearStaffingCard('선택 기간에 데이터가 없습니다.');
        return;
    }

    const stdHours = (appConfig && appConfig.standardDailyWorkHours) || { weekday: 8, weekend: 4 };
    const utilization = normalizedUtilization(appConfig);
    const basket = staffingBasketOf(appConfig);

    // 기준 속도는 선택 기간이 아니라 '전체 이력'에서 뽑는다.
    // 예전엔 선택 기간의 실적을 기준으로 삼아 물량이 약분돼 사라졌고,
    // 그래서 필요 인원이 실제 인원과 항상 붙어 버렸다(= 과부족이 안 보였다).
    const speeds = baselineSpeeds();
    const hasBaseline = Object.values(speeds).some(v => Number(v) > 0);

    // 운영일 = 출근 기록이 있거나 업무 기록이 있는 날.
    // 세 지표의 분모를 하나로 맞춰야 뺄셈(과부족)이 의미를 갖는다.
    // 예전엔 주말·휴일의 빈 문서까지 분모에 들어가 평균이 깎였다.
    const operatingDays = filteredData.filter(day =>
        attendedMembers(day, appConfig).size > 0 || (day.workRecords || []).length > 0
    );

    let sumAttended = 0;      // ① 실제 출근 인원
    let sumWorked = 0;        // ② 실 근무 인원
    let sumRequired = 0;      // ③ 표준 필요 인원
    let totalLossMinutes = 0;
    let donutWorkMinutes = 0; // 도넛의 '업무 기록 시간' — 손실과 같은 인원 집합만 센다
    let offRosterMinutes = 0; // 명부 밖(시스템계정·제외명단) 이름으로 올라온 업무시간
    let sumPresenceMinutes = 0, presenceDays = 0;
    let estimatedDays = 0;    // 출근 기록이 없어 업무 기록으로 대신 센 날
    let stdHourDays = 0;      // 재실시간을 못 구해 표준시간으로 대체한 날

    operatingDays.forEach(day => {
        const countable = countableMembersOf(day, appConfig);
        const attended = attendedMembers(day, appConfig);
        const records = day.workRecords || [];
        // 이름은 항상 trim 해서 비교·집계한다. 원문 그대로 넣으면 '김철'과 ' 김철'이
        // 다른 사람으로 세어져 '실 근무 인원'이 '실제 출근 인원'을 넘어선다.
        const nameOf = (r) => (r && r.member != null ? String(r.member).trim() : '');
        // ②도 ①과 같은 명부 기준으로 거른다. 안 그러면 시스템계정·명부 밖 이름 때문에
        // '실 근무 인원'이 '실제 출근 인원'보다 커지는 일이 생긴다.
        const workers = new Set(records.map(nameOf).filter(countable));
        sumAttended += attended.size;
        sumWorked += workers.size;
        if (isAttendanceEstimated(day, appConfig)) estimatedDays++;

        records.forEach(r => {
            if (!countable(nameOf(r))) offRosterMinutes += (Number(r.duration) || 0);
        });

        // 주중/주말에 따른 1인 표준 근무시간 (재실시간을 못 구할 때의 폴백)
        const dateObj = day.id ? new Date(day.id + 'T00:00:00') : null;
        const dow = dateObj && !isNaN(dateObj.getTime()) ? dateObj.getDay() : 1;
        const stdDailyHours = (dow === 0 || dow === 6) ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);

        // 1인 평균 재실시간(출근~퇴근, 점심 제외). 없으면 표준시간으로 대체.
        const presence = presenceStats(day, appConfig, attended);
        let availHours;
        if (presence.counted > 0) {
            availHours = presence.avgMinutesPerPerson / 60;
            sumPresenceMinutes += presence.avgMinutesPerPerson;
            presenceDays++;
        } else {
            availHours = stdDailyHours;
            stdHourDays++;
        }

        // 필요 인원 = 그날 수요(인시) ÷ (1인 가용시간 × 가동률)
        //  · 수요는 물량 ÷ 평상시 속도 (속도를 모르는 업무는 실제 쓴 시간)
        //  · 가동률은 재실시간 중 실제 업무로 잡히는 비율. 재실시간을 썼다고 이중 차감이 아니다
        //    (이중 차감이 되는 건 '실제 업무기록 시간'을 분모로 쓰면서 가동률을 또 곱할 때다)
        const demandMin = demandMinutesOf(day, speeds);
        if (availHours > 0 && utilization > 0) {
            sumRequired += (demandMin / 60) / (availHours * utilization);
        }

        // 근태 손실 = 재실시간 중 업무 기록이 없는 시간.
        // 분자·분모의 인원 집합을 맞춘다 — 재실시간은 '퇴근 기록이 있는 사람'만 잡히므로,
        // 업무시간도 그 사람들 것만 빼야 한다. 안 맞추면 퇴근 기록이 없는 사람이나
        // 공용계정의 업무시간이 남의 재실시간에서 차감돼 손실이 0으로 지워진다.
        let potential, workedForLoss;
        if (presence.counted > 0) {
            potential = presence.totalMinutes;
            workedForLoss = records
                .filter(r => presence.countedMembers.has(nameOf(r)))
                .reduce((s, r) => s + (Number(r.duration) || 0), 0);
        } else {
            potential = attended.size * stdDailyHours * 60;
            workedForLoss = records
                .filter(r => countable(nameOf(r)))
                .reduce((s, r) => s + (Number(r.duration) || 0), 0);
        }
        // 도넛 두 조각(업무 기록 시간 / 미기록)은 반드시 같은 집합이어야 한다.
        // 안 그러면 '업무시간 > 재실시간'이라는 불가능한 그림이 나온다.
        donutWorkMinutes += workedForLoss;
        if (potential > workedForLoss) totalLossMinutes += (potential - workedForLoss);
    });

    const dayCount = operatingDays.length;
    if (dayCount === 0) {
        // filteredData 는 있는데 전부 빈 날인 경우. 위의 '데이터 없음'과 같은 표기로 통일한다.
        clearStaffingCard('📉 선택 기간에 출근·업무 기록이 있는 날이 없습니다.');
        return;
    }
    const avgActual = dayCount > 0 ? sumAttended / dayCount : 0;
    const avgWorked = dayCount > 0 ? sumWorked / dayCount : 0;
    const avgRequired = dayCount > 0 ? sumRequired / dayCount : 0;
    const avgPresenceHours = presenceDays > 0 ? (sumPresenceMinutes / presenceDays) / 60 : 0;

    // UI 반영
    setText('staff-actual', `${avgActual.toFixed(1)} 명 / 일`);
    setText('staff-worked', `${avgWorked.toFixed(1)} 명 / 일`);
    setText('staff-required', `${avgRequired.toFixed(1)} 명 / 일`);
    setText('staff-total-loss', Math.round(totalLossMinutes).toLocaleString());

    const commentEl = document.getElementById('staff-fte-comment');
    if (commentEl) {
        // 실제로 물량이 잡힌 출고성 업무만 추려 보여 준다 — 빠진 업무가 있으면 여기서 바로 눈에 띈다
        const counted = [...basket].filter(t => operatingDays.some(d => (Number(d.taskQuantities?.[t]) || 0) > 0));
        const basketLabel = counted.length > 0 ? counted.join(' · ') : '해당 물량 없음';

        const todayStr = getTodayDateString();
        const notes = [];
        if (avgPresenceHours > 0) notes.push(`1인 평균 재실 ${avgPresenceHours.toFixed(1)}h (점심 제외)`);
        if (stdHourDays > 0) notes.push(`퇴근기록 없어 표준시간 적용 ${stdHourDays}일`);
        if (estimatedDays > 0) notes.push(`출근기록 없어 업무기록으로 추정 ${estimatedDays}일`);
        if (!hasBaseline) notes.push('평상시 속도 데이터 부족 — 실적 시간 기준');
        if (operatingDays.some(d => d.id === todayStr)) notes.push('오늘 포함(집계 진행 중)');
        if (offRosterMinutes > 0) notes.push(`명부 밖 계정 기록 ${Math.round(offRosterMinutes).toLocaleString()}분 포함(수요에만 반영)`);
        // 선택 기간이 기준 기간(전체 이력)과 거의 같으면 필요 인원이 실적에 수렴해 편차가 줄어든다.
        // 비교는 filteredData 기준 — allHistoryData 는 주말·공휴일까지 빈 문서로 채워져 있어
        // 운영일(dayCount)과 직접 비교하면 100% 겹쳐도 경고가 안 뜬다.
        const historyLen = (State.allHistoryData || []).length;
        if (historyLen > 0 && filteredData.length >= historyLen * 0.9) {
            notes.push('선택 기간이 전체 이력과 겹쳐 편차가 작게 나옵니다 — 기간을 좁혀 보세요');
        }

        const meta = `<span class="block mt-1 text-gray-400 dark:text-gray-500">`
            + `기준 속도: 전체 이력 평균(평상시) · 가동률 ${Math.round(utilization * 100)}% · 운영일 ${dayCount}일`
            + (notes.length > 0 ? ` · ${notes.join(' · ')}` : '')
            + `<br>출고성 업무: ${basketLabel}`
            + `</span>`;

        {
            // 기준은 '실제 출근 인원' — 출근한 사람 대비 그날 업무량이 몇 명분이었나
            const diff = avgActual - avgRequired;
            const idle = avgActual - avgWorked;
            const idleNote = idle >= 0.5
                ? ` 출근했지만 업무 기록이 없는 인원이 하루 평균 <strong>${idle.toFixed(1)}명</strong>입니다 — 기록 누락인지 확인해 보세요.`
                : '';
            if (diff > 1.0) {
                commentEl.innerHTML = `⚠️ 출근 인원 대비 업무량이 <strong class="text-amber-500">${diff.toFixed(1)}명분 적습니다</strong>. 인력 재배치나 업무 배분 점검이 권장됩니다.${idleNote}${meta}`;
            } else if (diff < -1.0) {
                commentEl.innerHTML = `🔥 업무 과부하! 출근 인원보다 <strong class="text-red-500">${Math.abs(diff).toFixed(1)}명분 더 필요한</strong> 업무량입니다. 추가 인력 소집을 검토하세요.${idleNote}${meta}`;
            } else {
                commentEl.innerHTML = `✅ 출근 인원과 업무량이 <strong class="text-green-500">균형</strong>을 이루고 있습니다.${idleNote}${meta}`;
            }
        }
    }

    // 도넛 차트 구성 (재실시간 중 업무 기록이 있는 시간 vs 없는 시간)
    const ctx = document.getElementById('chart-staffing-loss');
    if (ctx) {
        if (staffingChartInstance) staffingChartInstance.destroy();

        staffingChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['업무 기록 시간', '재실 중 미기록·대기'],
                datasets: [{
                    data: [donutWorkMinutes, totalLossMinutes],
                    backgroundColor: ['#3b82f6', '#f87171'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
            }
        });
    }

    // ── 차월 목표 매출 → 필요 인원 시뮬레이터 ──
    // 동작: 목표 매출 ÷ 가정 영업일 22 → 일평균 목표 매출. 현재 일평균 매출 대비
    // 스케일링 비율(target/현재)을 현재 평균 출근 인원에 곱해 필요 인원 산출.
    // 추가 알바 = max(0, 필요 인원 − 현재 평균 출근).
    const simBtn = document.getElementById('staffing-sim-btn');
    const simInput = document.getElementById('staffing-sim-input');
    const simResult = document.getElementById('staffing-sim-result');
    if (simBtn && simInput && simResult) {
        // 이전 클릭 리스너 제거를 위해 노드 교체 (renderStaffingTab 재호출 시 중복 바인딩 방지)
        const freshBtn = simBtn.cloneNode(true);
        simBtn.parentNode.replaceChild(freshBtn, simBtn);
        freshBtn.addEventListener('click', () => {
            const target = Number(simInput.value);
            if (!target || target <= 0) {
                simResult.innerHTML = '<div class="mt-3 pt-3 border-t border-white/30 text-yellow-100">목표 매출(원)을 입력해주세요.</div>';
                return;
            }
            const totalRev = filteredData.reduce((s, d) => s + (Number(d.management && d.management.revenue) || 0), 0);
            const revDays = filteredData.filter(d => Number(d.management && d.management.revenue) > 0).length;
            if (totalRev <= 0 || revDays === 0 || avgActual <= 0) {
                simResult.innerHTML = '<div class="mt-3 pt-3 border-t border-white/30 text-yellow-100">현재 기간 매출/출근 데이터가 부족해 예측할 수 없습니다.</div>';
                return;
            }
            const dailyRev = totalRev / revDays;
            const workingDays = 22; // 가정: 월 영업일 22일
            const targetDailyRev = target / workingDays;
            const scale = targetDailyRev / dailyRev;
            const requiredHeadcount = avgActual * scale;
            const additionalAlba = Math.max(0, requiredHeadcount - avgActual);
            const KRW = n => Math.round(n).toLocaleString();

            simResult.innerHTML = `
                <div class="mt-3 pt-3 border-t border-white/30 text-sm space-y-1">
                    <div>현재 일평균 매출: <strong>${KRW(dailyRev)}원</strong> <span class="text-[11px] text-indigo-100/80">(${revDays}일 기준)</span></div>
                    <div>목표 일평균 매출: <strong>${KRW(targetDailyRev)}원</strong> <span class="text-[11px] text-indigo-100/80">(월 22일 가정)</span></div>
                    <div>스케일링 비율: <strong>${scale.toFixed(2)}배</strong></div>
                    <div>필요 일평균 인원: <strong>${requiredHeadcount.toFixed(1)}명</strong> <span class="text-[11px] text-indigo-100/80">(현재 ${avgActual.toFixed(1)}명 기준 선형)</span></div>
                    <div class="pt-1 text-yellow-100 font-bold">→ 추가 필요 알바: <strong>${additionalAlba.toFixed(1)}명</strong></div>
                </div>
            `;
        });
    }
}

// ═══════════════════════════════════════════════════════════
// 📅 앞으로의 인원 수급 — 저장해 둔 예정 물량으로 '모자랄 날'을 미리 본다.
//
// 이 탭의 위쪽은 전부 '지나간 기간의 평균'이라, 정작 필요한
// "다음 주 화요일에 사람이 모자란다"를 알려주지 못했다.
// 예정 물량은 이미 저장되고 있으니(업무 예상의 작업량 저장 · 예정 물량 입력)
// 업무 예상과 같은 계산으로 앞날을 돌려 보여 준다.
// ═══════════════════════════════════════════════════════════

const OUTLOOK_DAYS = 10;

const fmtDay = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${w})`;
};

const outlookRow = (r, maxNeed, todayStr) => {
    const short = r.gap < 0;
    const barPct = maxNeed > 0 ? Math.min(100, Math.round(r.requiredFTE / maxNeed * 100)) : 0;
    const availPct = maxNeed > 0 ? Math.min(100, Math.round(r.available / maxNeed * 100)) : 0;
    const tone = short ? 'text-rose-600 dark:text-rose-400'
        : (r.gap > 2 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400');
    const gapText = r.gap === 0 ? '적정' : (r.gap > 0 ? `+${r.gap}명 여유` : `${Math.abs(r.gap)}명 부족`);

    return `
    <tr class="border-t border-gray-100 dark:border-gray-700/60 ${short ? 'bg-rose-50/50 dark:bg-rose-900/10' : ''}
               hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer staffing-outlook-row" data-date="${r.date}"
        title="누르면 업무 예상에서 이 날짜를 자세히 볼 수 있습니다">
        <td class="py-2 px-3 whitespace-nowrap font-medium text-gray-700 dark:text-gray-200">
            ${fmtDay(r.date)}${r.date === todayStr ? '<span class="ml-1 text-[10px] font-bold text-indigo-500">오늘</span>' : ''}
        </td>
        <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
            ${r.totalHours.toFixed(1)}<span class="text-[10px] ml-0.5">인시</span>
        </td>
        <td class="py-2 px-3">
            <div class="relative h-4 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden min-w-[90px]">
                <div class="absolute inset-y-0 left-0 ${short ? 'bg-rose-400' : 'bg-indigo-400'} opacity-80" style="width:${barPct}%"></div>
                <div class="absolute inset-y-0 border-r-2 border-gray-700 dark:border-gray-200" style="left:${availPct}%" title="가용 ${r.available}명"></div>
            </div>
        </td>
        <td class="py-2 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">${r.requiredFTE}명</td>
        <td class="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
            ${r.available}명${r.onLeave > 0 ? `<span class="text-[10px] text-gray-400 ml-1">(휴무 ${r.onLeave})</span>` : ''}
        </td>
        <td class="py-2 px-3 text-right whitespace-nowrap font-bold ${tone}">${gapText}</td>
        <td class="py-2 px-2 text-center">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${r.hasPlanned
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'}"
                  title="${r.hasPlanned ? '저장해 둔 예정 물량으로 계산했습니다' : '예정 물량이 없어 실적 기반 자동 추정으로 계산했습니다'}">${r.hasPlanned ? '예정' : '추정'}</span>
        </td>
    </tr>`;
};

export function renderStaffingOutlook() {
    const host = document.getElementById('staffing-outlook');
    if (!host) return;

    let rows = [];
    try { rows = getStaffingOutlook(OUTLOOK_DAYS) || []; }
    catch (e) { console.error('[staffing-outlook] 실패:', e); }

    if (rows.length === 0) {
        host.innerHTML = '';
        return;
    }

    const todayStr = getTodayDateString();
    const maxNeed = Math.max(...rows.map(r => Math.max(r.requiredFTE, r.available)), 1);
    const shortDays = rows.filter(r => r.gap < 0);
    const worst = shortDays.reduce((a, b) => (a && a.gap <= b.gap ? a : b), null);
    const plannedCount = rows.filter(r => r.hasPlanned).length;

    const headline = shortDays.length === 0
        ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold">${rows.length}근무일 모두 인원이 충분합니다.</span>`
        : `<span class="text-rose-600 dark:text-rose-400 font-bold">${rows.length}근무일 중 ${shortDays.length}일 부족</span>`
          + (worst ? ` <span class="text-gray-500 dark:text-gray-400">— 가장 모자란 날 ${fmtDay(worst.date)} <b>${Math.abs(worst.gap)}명</b></span>` : '');

    host.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 depth-panel overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 class="text-sm md:text-md font-bold text-gray-800 dark:text-white">📅 앞으로 ${rows.length}근무일 인원 수급</h4>
            <span class="text-[11px] text-gray-400 dark:text-gray-500">
                저장해 둔 예정 물량 ${plannedCount}일 · 나머지는 실적 기반 추정 · 업무 예상과 같은 계산
            </span>
        </div>
        <div class="px-5 py-3 text-xs md:text-sm border-b border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/20">${headline}</div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                        <th class="py-2.5 px-3 text-left font-bold">날짜</th>
                        <th class="py-2.5 px-3 text-right font-bold" title="그날 모든 업무의 인시 합계">작업량</th>
                        <th class="py-2.5 px-3 text-left font-bold w-[24%]">필요 대비 가용</th>
                        <th class="py-2.5 px-3 text-right font-bold">필요</th>
                        <th class="py-2.5 px-3 text-right font-bold">가용</th>
                        <th class="py-2.5 px-3 text-right font-bold">과부족</th>
                        <th class="py-2.5 px-2 text-center font-bold" title="예정 = 저장해 둔 물량 / 추정 = 실적 기반 자동값">근거</th>
                    </tr>
                </thead>
                <tbody>${rows.map(r => outlookRow(r, maxNeed, todayStr)).join('')}</tbody>
            </table>
        </div>
        <p class="px-5 py-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
            · 막대는 <b>필요 인원</b>, 세로선은 <b>가용 인원</b>입니다. 막대가 선을 넘으면 그날 사람이 모자랍니다.<br>
            · <b class="text-gray-500 dark:text-gray-300">추정</b>인 날은 예정 물량을 아직 넣지 않아 과거 실적으로 어림한 값입니다 —
              물량을 알고 있다면 <b>업무 예상 › 계획</b>에서 넣어 두면 이 표가 정확해집니다.<br>
            · 줄을 누르면 업무 예상에서 그 날짜를 자세히 볼 수 있습니다.
        </p>
    </div>`;

    // 줄 클릭 → 업무 예상 탭에서 그 날짜 열기
    if (!host.dataset.bound) {
        host.dataset.bound = 'true';
        host.addEventListener('click', (e) => {
            const row = e.target.closest('.staffing-outlook-row');
            if (!row || !row.dataset.date) return;
            document.querySelector('[data-main-tab="forecast"]')?.click();
            setTimeout(() => {
                const el = document.getElementById('sim-target-date');
                if (!el) return;
                el.value = row.dataset.date;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, 500);
        });
    }
}
