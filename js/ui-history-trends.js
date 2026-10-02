// === ui-history-trends.js (트렌드 분석 차트 렌더링 담당) ===

import { isWeekday, formatDuration, getRegularMembersForCount, buildMemberHourlyWageMap } from './utils.js?v=202610021042';

// ✅ [신규] app.js 대신 state.js에서 직접 appConfig를 가져옵니다.
import { appConfig } from './state.js?v=202610021042';

/**
 * 트렌드 분석용 일일 KPI 계산 헬퍼
 * (ui-history.js -> ui-history-trends.js)
 */
function calculateDailyKPIs(dayData, appConfig) {
    const records = dayData.workRecords || [];
    const quantities = dayData.taskQuantities || {};
    const onLeaveMemberEntries = dayData.onLeaveMembers || [];
    const partTimersFromHistory = dayData.partTimers || [];

    // 1. WageMap 생성 (memberWages 월기본급 → 시급 ÷209, + 이력의 알바 시급)
    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages);
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });

    // 2. 총 시간, 총 비용, 총 수량
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    // 3. KPI: 처리량, 비용
    const throughput = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const costPerItem = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    // 4. KPI: 비업무시간
    let nonWorkTime = 0;
    if (isWeekday(dayData.id)) {
        const allRegularMembers = getRegularMembersForCount(appConfig, dayData.id); // 해당 날짜 재직 인원(퇴사자 과거 보존)
        const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
        
        const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
        const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
        const activeMembersCount = activeRegularMembers + activePartTimers;

        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간(480분) 기준
        nonWorkTime = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        throughput: parseFloat(throughput.toFixed(2)),
        costPerItem: parseFloat(costPerItem.toFixed(0)),
        nonWorkTime: parseFloat(nonWorkTime.toFixed(0))
    };
}

/**
 * 트렌드 분석 탭의 차트를 렌더링
 * (ui-history.js -> ui-history-trends.js)
 * (trendCharts는 app.js에서 생성되어 listeners-history.js를 통해 인자로 전달됨)
 */
export const renderTrendAnalysisCharts = (allHistoryData, appConfig, trendCharts) => {
    try {
        // 1. 기존 차트가 있다면 파괴 (메모리 누수 방지)
        Object.values(trendCharts).forEach(chart => chart.destroy());

        // 2. 데이터 준비 (최근 30일)
        const dataSlice = allHistoryData.slice(0, 30).reverse(); // 30일치, 시간순 (오래된 -> 최신)

        const throughputCtx = document.getElementById('kpi-chart-throughput');
        const costCtx = document.getElementById('kpi-chart-cost');
        const nonWorkCtx = document.getElementById('kpi-chart-nonwork');
        
        // 캔버스가 없으면 종료
        if (!throughputCtx || !costCtx || !nonWorkCtx) {
             console.warn("트렌드 분석: 차트 캔버스를 찾을 수 없습니다.");
             return;
        }

        if (dataSlice.length === 0) {
            // 데이터가 없을 때의 처리
            console.warn("트렌드 분석: 표시할 데이터가 없습니다.");
            [throughputCtx, costCtx, nonWorkCtx].forEach(ctx => {
                if (!ctx) return; 
                const context = ctx.getContext('2d');
                context.clearRect(0, 0, ctx.width, ctx.height);
                context.font = "16px 'Noto Sans KR'";
                context.fillStyle = "#9ca3af";
                context.textAlign = "center";
                context.fillText("표시할 데이터가 없습니다.", ctx.width / 2, ctx.height / 2);
            });
            return;
        }

        const labels = [];
        const throughputData = [];
        const costData = [];
        const nonWorkData = [];

        // 3. KPI 데이터 추출
        dataSlice.forEach(dayData => {
            labels.push(dayData.id.substring(5)); // 'MM-DD'
            const kpis = calculateDailyKPIs(dayData, appConfig);
            throughputData.push(kpis.throughput);
            costData.push(kpis.costPerItem);
            nonWorkData.push(kpis.nonWorkTime);
        });

        // 4. 차트 생성
        const chartOptions = (titleText) => ({
            responsive: true,
            maintainAspectRatio: false, // 캔버스 크기에 맞춤
            plugins: {
                legend: { display: false },
                title: { display: false, text: titleText }, 
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        });

        if (throughputCtx) {
            trendCharts.throughput = new Chart(throughputCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '분당 처리량',
                        data: throughputData,
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('분당 평균 처리량 (개/분)')
            });
        }

        if (costCtx) {
            trendCharts.cost = new Chart(costCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '개당 처리비용',
                        data: costData,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('개당 평균 처리비용 (원/개)')
            });
        }

        if (nonWorkCtx) {
            trendCharts.nonWork = new Chart(nonWorkCtx, {
                type: 'bar', // 비업무시간은 바로
                data: {
                    labels: labels,
                    datasets: [{
                        label: '총 비업무시간',
                        data: nonWorkData,
                        backgroundColor: 'rgba(75, 192, 192, 0.6)'
                    }]
                },
                options: chartOptions('총 비업무시간 (분)')
            });
        }
    } catch (e) {
        console.error("트렌드 차트 렌더링 실패:", e);
    }
};