// === js/ui-history-staffing.js ===
import * as State from './state.js';

let staffingChartInstance = null;

export function renderStaffingTab(filteredData, appConfig) {
    if (!filteredData || filteredData.length === 0) return;

    let totalDays = filteredData.length;
    let sumActualStaff = 0;
    let sumRequiredStaff = 0;
    let totalLossMinutes = 0;
    let totalWorkMinutes = 0;

    filteredData.forEach(day => {
        const uniqueWorkers = new Set((day.workRecords || []).map(r => r.member));
        sumActualStaff += uniqueWorkers.size;

        let dayWorkTime = 0;
        let dayQty = 0;
        (day.workRecords || []).forEach(r => { dayWorkTime += (r.duration || 0); });
        Object.values(day.taskQuantities || {}).forEach(q => { dayQty += (Number(q) || 0); });

        totalWorkMinutes += dayWorkTime;

        // 표준 속도(시간당 180개 가정) 기반 적정 필요 FTE 계산
        const standardHoursRequired = dayQty / 185; 
        sumRequiredStaff += (standardHoursRequired / 8);

        // 정규 시간(1인당 8시간) 대비 미달 시간 집계
        const potential = uniqueWorkers.size * 480;
        if (potential > dayWorkTime) {
            totalLossMinutes += (potential - dayWorkTime);
        }
    });

    const avgActual = sumActualStaff / totalDays;
    const avgRequired = sumRequiredStaff / totalDays;

    // UI 반영
    document.getElementById('staff-actual').textContent = `${avgActual.toFixed(1)} 명 / 일`;
    document.getElementById('staff-required').textContent = `${avgRequired.toFixed(1)} 명 / 일`;
    document.getElementById('staff-total-loss').textContent = Math.round(totalLossMinutes).toLocaleString();

    const commentEl = document.getElementById('staff-fte-comment');
    if (commentEl) {
        const diff = avgActual - avgRequired;
        if (diff > 0.8) {
            commentEl.innerHTML = `⚠️ 현재 업무량 대비 <strong class="text-amber-500">${diff.toFixed(1)}명 과원</strong> 상태입니다. 작업 속도 조정이나 인력 재배치가 권장됩니다.`;
        } else if (diff < -0.8) {
            commentEl.innerHTML = `🔥 업무 과부하! 표준 속도 대비 <strong class="text-red-500">${Math.abs(diff).toFixed(1)}명 부족</strong> 상태입니다. 추가 파트타이머 소집이 필요합니다.`;
        } else {
            commentEl.innerHTML = `✅ 투입 인원과 표준 요구량이 일치하는 <strong class="text-green-500">최적화된 인력 구조</strong>입니다.`;
        }
    }

    // 도넛 차트 구성 (정상 업무 시간 vs 손실 시간 비율)
    const ctx = document.getElementById('chart-staffing-loss');
    if (ctx) {
        if (staffingChartInstance) staffingChartInstance.destroy();

        staffingChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['생산 업무 시간', '근태 손실/대기'],
                datasets: [{
                    data: [totalWorkMinutes, totalLossMinutes],
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
}