// === js/ui-history-dashboard.js ===
import * as State from './state.js';
import { analyzeUnitCost } from './ui-history-reports-logic.js';

let dashboardChartInstance = null;

export function renderDashboardTab(filteredData, appConfig) {
    if (!filteredData || filteredData.length === 0) {
        document.getElementById('ai-dashboard-comment').textContent = "조회된 기간에 이력 데이터가 없습니다.";
        document.getElementById('kpi-total-time').innerHTML = `0<span class="text-sm font-medium text-gray-500 ml-1">h</span>`;
        
        // 새로 추가된 지표 초기화
        const avgWorkDaysEl = document.getElementById('kpi-avg-work-days');
        if(avgWorkDaysEl) avgWorkDaysEl.innerHTML = `0.0<span class="text-sm font-medium text-gray-500 ml-1">일</span>`;
        const totalQtyEl = document.getElementById('kpi-total-qty');
        if(totalQtyEl) totalQtyEl.innerHTML = `0<span class="text-sm font-medium text-gray-500 ml-1">건</span>`;

        document.getElementById('kpi-avg-uph').innerHTML = `0.0<span class="text-sm font-medium text-blue-400 ml-1">개/시</span>`;
        document.getElementById('kpi-total-oee').innerHTML = `0<span class="text-sm font-medium text-green-400 ml-1">%</span>`;
        
        const unitCostEl = document.getElementById('kpi-unit-cost');
        if(unitCostEl) {
            unitCostEl.innerHTML = `0<span class="text-sm font-medium text-purple-400 ml-1">원</span>`;
            if(unitCostEl.previousElementSibling) unitCostEl.previousElementSibling.textContent = '총 출고원가 (건당)';
        }
        const turnoverEl = document.getElementById('kpi-inventory-turnover');
        if(turnoverEl) turnoverEl.innerHTML = `0.0<span class="text-sm font-medium text-orange-400 ml-1">회</span>`;
        
        if (dashboardChartInstance) dashboardChartInstance.destroy();
        return;
    }

    let totalDurationMin = 0;
    let totalActualDurationMin = 0; 
    let totalQty = 0;
    
    // 평균 근무일수 계산용 변수 추가
    const uniqueMembersAllTime = new Set();
    let totalWorkerDays = 0;

    const trendLabels = [];
    const uphTrendData = [];
    const timeTrendData = [];
    const actualTimeTrendData = []; 
    
    const taskTypes = ['국내배송', '중국제작', '직진배송'];
    const partSummary = {
        '국내배송': { duration: 0, qty: 0 },
        '중국제작': { duration: 0, qty: 0 },
        '직진배송': { duration: 0, qty: 0 }
    };

    const wageMap = { ...(appConfig.memberWages || {}) };

    const aggregatedWorkRecords = [];
    const aggregatedQuantities = {};
    let totalOrderCount = 0;
    let totalRevenue = 0;
    let totalInventoryAmt = 0;
    let daysWithInventory = 0;

    const sortedData = [...filteredData].sort((a, b) => a.id.localeCompare(b.id));

    sortedData.forEach(day => {
        const dateStr = day.id.substring(5); // 'MM-DD'
        trendLabels.push(dateStr);
        
        (day.partTimers || []).forEach(pt => {
            if (pt.name) wageMap[pt.name] = pt.wage || 0;
        });

        let dayDuration = 0;
        let dayQty = 0;
        const uniqueMembers = new Set();

        (day.workRecords || []).forEach(r => {
            dayDuration += (r.duration || 0);
            if (r.member) {
                uniqueMembers.add(r.member);
                uniqueMembersAllTime.add(r.member); // 전체 기간 중 활동한 고유 인원 수집
            }
            
            const matchedType = taskTypes.find(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
            if (matchedType) partSummary[matchedType].duration += (r.duration || 0);
            
            aggregatedWorkRecords.push({ ...r, date: day.id });
        });

        // 하루 동안 투입된 총 인원수를 더함 (연인원 개념)
        totalWorkerDays += uniqueMembers.size;

        Object.entries(day.taskQuantities || {}).forEach(([taskKey, qty]) => {
            const numQty = Number(qty) || 0;
            dayQty += numQty;
            
            const matchedType = taskTypes.find(t => taskKey.includes(t));
            if (matchedType) partSummary[matchedType].qty += numQty;
            
            aggregatedQuantities[taskKey] = (aggregatedQuantities[taskKey] || 0) + numQty;
        });

        const mgmt = day.management || {};
        totalOrderCount += (Number(mgmt.orderCount) || 0);
        totalRevenue += (Number(mgmt.revenue) || 0);
        
        if (Number(mgmt.inventoryAmt) > 0) {
            totalInventoryAmt += Number(mgmt.inventoryAmt);
            daysWithInventory++;
        }

        const dayActualDuration = uniqueMembers.size > 0 ? dayDuration / uniqueMembers.size : 0;
        
        totalDurationMin += dayDuration;
        totalActualDurationMin += dayActualDuration; 
        totalQty += dayQty;

        const dayUph = dayDuration > 0 ? (dayQty / (dayDuration / 60)) : 0;
        uphTrendData.push(parseFloat(dayUph.toFixed(1)));
        timeTrendData.push(parseFloat((dayDuration / 60).toFixed(1)));
        actualTimeTrendData.push(parseFloat((dayActualDuration / 60).toFixed(1)));
    });

    const analysis = analyzeUnitCost(
        { 
            id: 'dashboard-aggregated', 
            workRecords: aggregatedWorkRecords, 
            taskQuantities: aggregatedQuantities, 
            management: { orderCount: totalOrderCount } 
        },
        appConfig,
        wageMap,
        totalRevenue
    );

    const totalHours = totalDurationMin / 60;
    const totalActualHours = totalActualDurationMin / 60;
    const avgUph = totalHours > 0 ? (totalQty / totalHours) : 0;
    const unitCost = analysis.isValid ? analysis.costs.total : 0;
    const avgInventoryAmt = daysWithInventory > 0 ? (totalInventoryAmt / daysWithInventory) : 0;
    const turnoverRate = avgInventoryAmt > 0 ? (totalRevenue / avgInventoryAmt) : 0;
    
    // 평균 근무일수 계산 (총 투입 연인원 / 전체 기간 중 일한 고유 인원)
    const avgWorkDays = uniqueMembersAllTime.size > 0 ? (totalWorkerDays / uniqueMembersAllTime.size) : 0;

    const TARGET_UPH = 200; 
    const oee = Math.min(100, Math.max(0, (avgUph / TARGET_UPH) * 100)); 

    // KPI 렌더링 업데이트
    document.getElementById('kpi-total-time').innerHTML = `
        ${Math.round(totalHours).toLocaleString()}<span class="text-sm font-medium text-gray-500 ml-1">h</span>
        <div class="text-sm font-bold text-blue-600 mt-1 bg-blue-50/50 inline-block px-1.5 py-0.5 rounded">인당 평균: ${Math.round(totalActualHours).toLocaleString()}h</div>
    `;
    
    // 새로 추가된 KPI 렌더링
    const avgWorkDaysEl = document.getElementById('kpi-avg-work-days');
    if(avgWorkDaysEl) avgWorkDaysEl.innerHTML = `${avgWorkDays.toFixed(1)}<span class="text-sm font-medium text-gray-500 ml-1">일</span>`;
    
    const totalQtyEl = document.getElementById('kpi-total-qty');
    if(totalQtyEl) totalQtyEl.innerHTML = `${Math.round(totalQty).toLocaleString()}<span class="text-sm font-medium text-gray-500 ml-1">건</span>`;

    document.getElementById('kpi-avg-uph').innerHTML = `${avgUph.toFixed(1)}<span class="text-sm font-medium text-blue-400 ml-1">개/시</span>`;
    document.getElementById('kpi-total-oee').innerHTML = `${oee.toFixed(1)}<span class="text-sm font-medium text-green-400 ml-1">%</span>`;
    
    const unitCostEl = document.getElementById('kpi-unit-cost');
    if(unitCostEl) {
        unitCostEl.innerHTML = `${Math.round(unitCost).toLocaleString()}<span class="text-sm font-medium text-purple-400 ml-1">원</span>`;
        if(unitCostEl.previousElementSibling) unitCostEl.previousElementSibling.textContent = '총 출고원가 (건당)';
    }
    
    const turnoverEl = document.getElementById('kpi-inventory-turnover');
    if(turnoverEl) turnoverEl.innerHTML = `${turnoverRate.toFixed(2)}<span class="text-sm font-medium text-orange-400 ml-1">회</span>`;

    const aiCommentEl = document.getElementById('ai-dashboard-comment');
    let lowestPart = '';
    let lowestUph = Infinity;
    taskTypes.forEach(type => {
        const pHours = partSummary[type].duration / 60;
        const pUph = pHours > 0 ? (partSummary[type].qty / pHours) : Infinity;
        if(pHours > 0 && pUph < lowestUph) {
            lowestUph = pUph;
            lowestPart = type;
        }
    });

    let diagnosticHtml = '';
    if (oee < 60) {
        diagnosticHtml = `
            <div class="text-red-700 mb-2">⚠️ <strong class="font-bold text-lg">생산 효율 경고: 기준치 대비 ${Math.round(100 - oee)}% 저하되었습니다.</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li><span class="font-bold text-gray-900">가장 취약한 파트:</span> <span class="bg-red-100 text-red-800 px-1 rounded">${lowestPart || '전반적'}</span> (현재 UPH: ${lowestUph === Infinity ? 0 : Math.round(lowestUph)})</li>
                <li><span class="font-bold text-gray-900">조치 권고사항:</span> 
                    해당 파트에 <span class="text-blue-600 font-bold">인력을 추가 배치(1~2명)</span>하거나, 
                    작업자들의 피로도를 고려하여 <span class="text-green-600 font-bold">10분간 강제 휴식</span>을 부여하세요.
                </li>
                <li>현재 건당 총 출고 원가가 <strong>${Math.round(unitCost).toLocaleString()}원</strong>으로 상승 추세입니다. 병목 해소가 시급합니다.</li>
            </ul>
        `;
    } else if (oee >= 90) {
         diagnosticHtml = `
            <div class="text-blue-700 mb-2">🔥 <strong class="font-bold text-lg">최상 컨디션: 목표 달성률 ${Math.round(oee)}%</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li>현재의 속도가 지속될 경우, 남은 업무량 대비 투입 인원이 남을 수 있습니다.</li>
                <li><span class="font-bold text-gray-900">조치 권고사항:</span> 작업 속도가 빠른 인원을 <span class="text-blue-600 font-bold">내일 업무 준비나 재고 조사 등</span> 다른 업무로 전환하여 유휴 시간을 줄이세요.</li>
                <li>건당 총 출고 원가가 <strong>${Math.round(unitCost).toLocaleString()}원</strong>으로 낮게 방어되어 수익성이 매우 좋습니다.</li>
            </ul>
        `;
    } else {
         diagnosticHtml = `
            <div class="text-green-700 mb-2">✅ <strong class="font-bold text-lg">안정적 운영 상태 (효율 ${Math.round(oee)}%)</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li>현재 목표 UPH(${TARGET_UPH}) 대비 <span class="font-bold">${avgUph.toFixed(1)}</span>으로 안정적인 처리 속도를 유지 중입니다.</li>
                <li><span class="font-bold text-gray-900">모니터링 대상:</span> <span class="bg-yellow-100 text-yellow-800 px-1 rounded">${lowestPart || '일부 파트'}</span> 파트의 처리량이 약간 저하되고 있는지 지속 관찰하세요.</li>
            </ul>
        `;
    }
    aiCommentEl.innerHTML = diagnosticHtml;

    const ctx = document.getElementById('chart-dashboard-trend');
    if (!ctx) return;
    if (dashboardChartInstance) { dashboardChartInstance.destroy(); }

    dashboardChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trendLabels,
            datasets: [
                {
                    label: '종합 UPH (생산성)',
                    data: uphTrendData,
                    borderColor: '#2563eb', 
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    type: 'line',
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: '총 투입 인력 시간 (Hours)',
                    data: timeTrendData,
                    backgroundColor: '#cbd5e1', 
                    type: 'bar',
                    borderRadius: 4,
                    yAxisID: 'y1'
                },
                {
                    label: '실제 소요 시간 (인당 평균 Hours)',
                    data: actualTimeTrendData,
                    backgroundColor: '#93c5fd', 
                    type: 'bar',
                    borderRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, font: { family: "'Inter', sans-serif", weight: 'bold' } } }
            },
            scales: {
                y: { 
                    type: 'linear', display: true, position: 'left', 
                    title: { display: true, text: 'UPH (개/시간)', color: '#2563eb', font: { weight: 'bold' } },
                    grid: { borderDash: [5, 5] }
                },
                y1: { 
                    type: 'linear', display: true, position: 'right', 
                    title: { display: true, text: '시간(h)', color: '#64748b', font: { weight: 'bold' } },
                    grid: { drawOnChartArea: false } 
                }
            }
        }
    });
}