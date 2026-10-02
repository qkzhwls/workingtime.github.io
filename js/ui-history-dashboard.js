// === js/ui-history-dashboard.js ===
import * as State from './state.js?v=202610021042';
import { analyzeUnitCost } from './ui-history-reports-logic.js?v=202610021042';
import { getWeekOfYear, toDateString, buildMemberHourlyWageMap } from './utils.js?v=202610021042';
import { revenueTotalOf, orderCountTotalOf } from './revenue-channels.js?v=202610021042';

let dashboardChartInstance = null;

// 주어진 일자 데이터들의 종합 UPH 계산 (대시보드 종합 UPH 정의와 동일)
const computeAvgUphFromDays = (days) => {
    let totalDur = 0, totalQty = 0;
    (days || []).forEach(d => {
        (d.workRecords || []).forEach(r => { totalDur += (r.duration || 0); });
        Object.values(d.taskQuantities || {}).forEach(q => { totalQty += (Number(q) || 0); });
    });
    return totalDur > 0 ? (totalQty / (totalDur / 60)) : 0;
};

/**
 * 하이브리드 기준 데이터 선정
 *  - 일:  최근 7일 평균(롤링)
 *  - 주:  최근 4주 평균(롤링)
 *  - 월:  작년 같은 달 우선 → 없으면 최근 3개월 평균(롤링) 폴백
 *  - 년:  전년도 우선 → 없으면 비교 불가
 * @returns { data, type, description, range } — data 빈 배열이면 비교 기준 없음
 */
const getBaselinePeriod = (granularity, selectedKey, allHistoryData) => {
    const none = { data: [], type: 'none', description: '비교용 기준 데이터 없음', range: null };
    if (!selectedKey || !Array.isArray(allHistoryData) || allHistoryData.length === 0) return none;

    if (granularity === 'day') {
        const target = new Date(selectedKey + 'T00:00:00');
        if (isNaN(target.getTime())) return none;
        const start = new Date(target); start.setDate(start.getDate() - 7);
        const end   = new Date(target); end.setDate(end.getDate() - 1);
        const startStr = toDateString(start);
        const endStr   = toDateString(end);
        const data = allHistoryData.filter(d => d.id >= startStr && d.id <= endStr);
        if (data.some(d => (d.workRecords||[]).length > 0)) {
            return { data, type: 'rolling', description: `최근 7일 평균 (${startStr} ~ ${endStr})`, range: `${startStr} ~ ${endStr}` };
        }
        return none;
    }

    if (granularity === 'week') {
        const allWeekKeys = [...new Set(allHistoryData.map(d => {
            try { return getWeekOfYear(new Date(d.id + 'T00:00:00')); } catch (e) { return null; }
        }).filter(Boolean))].sort();
        const idx = allWeekKeys.indexOf(selectedKey);
        if (idx <= 0) return none;
        const prevKeys = allWeekKeys.slice(Math.max(0, idx - 4), idx);
        if (prevKeys.length === 0) return none;
        const data = allHistoryData.filter(d => {
            try { return prevKeys.includes(getWeekOfYear(new Date(d.id + 'T00:00:00'))); } catch (e) { return false; }
        });
        const desc = prevKeys.length >= 4
            ? `최근 4주 평균 (${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]})`
            : `최근 ${prevKeys.length}주 평균 (${prevKeys.join(', ')})`;
        return { data, type: prevKeys.length >= 4 ? 'rolling' : 'rolling_short', description: desc, range: `${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}` };
    }

    if (granularity === 'month') {
        const m = selectedKey.match(/^(\d{4})-(\d{2})$/);
        if (!m) return none;
        const year = parseInt(m[1], 10);
        const mm = m[2];
        // 1순위: 작년 같은 달
        const yoyKey = `${year - 1}-${mm}`;
        const yoyData = allHistoryData.filter(d => typeof d.id === 'string' && d.id.substring(0,7) === yoyKey);
        if (yoyData.some(d => (d.workRecords||[]).length > 0)) {
            return { data: yoyData, type: 'yoy', description: `작년 같은 달 (${yoyKey})`, range: yoyKey };
        }
        // 폴백: 최근 3개월 롤링
        const allMonthKeys = [...new Set(allHistoryData.map(d => typeof d.id === 'string' ? d.id.substring(0,7) : null).filter(Boolean))].sort();
        const idx = allMonthKeys.indexOf(selectedKey);
        if (idx <= 0) return { ...none, description: `${yoyKey} 데이터 없고 직전 월도 없어 비교 불가` };
        const prevKeys = allMonthKeys.slice(Math.max(0, idx - 3), idx);
        const data = allHistoryData.filter(d => prevKeys.includes(d.id.substring(0,7)));
        const desc = (prevKeys.length >= 3 ? `최근 3개월 평균` : `최근 ${prevKeys.length}개월 평균`)
            + ` (${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}) — 작년 동월(${yoyKey}) 데이터 없어 폴백`;
        return { data, type: 'rolling_fallback', description: desc, range: `${prevKeys[0]} ~ ${prevKeys[prevKeys.length-1]}` };
    }

    if (granularity === 'year') {
        if (!/^\d{4}$/.test(selectedKey)) return none;
        const year = parseInt(selectedKey, 10);
        const prevYearKey = String(year - 1);
        const prevYearData = allHistoryData.filter(d => typeof d.id === 'string' && d.id.substring(0,4) === prevYearKey);
        if (prevYearData.some(d => (d.workRecords||[]).length > 0)) {
            return { data: prevYearData, type: 'yoy', description: `전년도 (${prevYearKey})`, range: prevYearKey };
        }
        return { ...none, description: `전년도(${prevYearKey}) 데이터 없어 비교 불가` };
    }

    return none;
};

export function renderDashboardTab(filteredData, appConfig) {
    // 📍 마일스톤 위젯 (lazy import, 비동기 — 실패해도 메인 렌더에는 영향 없음)
    const milestoneWidget = document.getElementById('dashboard-milestones-widget');
    if (milestoneWidget) {
        import('./ui-history-milestones.js?v=202610021042').then(mod => {
            mod.renderMilestonesInsightWidget(milestoneWidget);
        }).catch(e => console.warn('milestones widget load failed:', e));
    }

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
    
    // 평균 근무일수 계산용 (출근=dailyAttendance 기준, 정규 팀원만 집계)
    const _excludedForHeadcount = new Set([
        ...(appConfig.systemAccounts || []),
        ...(appConfig.headcountExcludedMembers || [])
    ]);
    const regularMembers = new Set();
    (appConfig.teamGroups || []).forEach(g => (g.members || []).forEach(m => {
        if (m && !_excludedForHeadcount.has(m)) regularMembers.add(m);
    }));
    const attendedRegularMembers = new Set(); // 기간 내 1번이라도 출근한 정규 팀원 (분모)
    let totalAttendanceDays = 0;              // 정규 팀원 출근 연인원 (분자)

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

    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)

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
            }
            
            const matchedType = taskTypes.find(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
            if (matchedType) partSummary[matchedType].duration += (r.duration || 0);
            
            aggregatedWorkRecords.push({ ...r, date: day.id });
        });

        // 평균 근무일수: 출근(dailyAttendance) 기준으로 그날 출근한 정규 팀원 집계
        const dayAttendance = day.dailyAttendance || {};
        Object.keys(dayAttendance).forEach(name => {
            if (!regularMembers.has(name)) return;                            // 정규 팀원만
            if (!dayAttendance[name] || !dayAttendance[name].inTime) return;  // 실제 출근(inTime)만
            totalAttendanceDays++;
            attendedRegularMembers.add(name);
        });

        Object.entries(day.taskQuantities || {}).forEach(([taskKey, qty]) => {
            const numQty = Number(qty) || 0;
            dayQty += numQty;
            
            const matchedType = taskTypes.find(t => taskKey.includes(t));
            if (matchedType) partSummary[matchedType].qty += numQty;
            
            aggregatedQuantities[taskKey] = (aggregatedQuantities[taskKey] || 0) + numQty;
        });

        const mgmt = day.management || {};
        totalOrderCount += orderCountTotalOf(mgmt);
        totalRevenue += revenueTotalOf(mgmt);
        
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
    
    // 평균 근무일수 = 정규 팀원 출근 연인원 / 기간 내 출근한 정규 팀원 고유 인원
    // (출근=dailyAttendance.inTime 기준, 시스템/제외계정·파트타이머 제외)
    const avgWorkDays = attendedRegularMembers.size > 0 ? (totalAttendanceDays / attendedRegularMembers.size) : 0;

    // 하이브리드 기준치: 단위에 따라 롤링/전년 동기 선택
    const granularity = State.context?.globalGranularity || 'day';
    const selectedKey = document.querySelector('.history-date-btn.bg-blue-100')?.dataset.key || null;
    const baseline = getBaselinePeriod(granularity, selectedKey, State.allHistoryData);
    const baselineUph = computeAvgUphFromDays(baseline.data);
    const hasBaseline = baselineUph > 0;
    // oee = 현재 UPH / 기준 UPH × 100 (100%면 평소 수준)
    const oee = hasBaseline ? Math.min(200, Math.max(0, (avgUph / baselineUph) * 100)) : 0;

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
    const oeeEl = document.getElementById('kpi-total-oee');
    if (oeeEl) {
        const oeeLabel = oeeEl.previousElementSibling;
        if (oeeLabel) {
            oeeLabel.textContent = '기준 대비 효율';
            oeeLabel.title = hasBaseline ? `${baseline.description} (기준 UPH ${baselineUph.toFixed(1)}개/시)` : baseline.description;
        }
        oeeEl.innerHTML = hasBaseline
            ? `${oee.toFixed(1)}<span class="text-sm font-medium text-green-400 ml-1">%</span>`
            : `—<span class="text-sm font-medium text-gray-400 ml-1">%</span>`;
        oeeEl.title = oeeLabel?.title || '';
    }
    
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

    // 기준 정보 메타 (마우스오버 + 화면 표기)
    const baselineMetaHtml = hasBaseline
        ? `<div class="text-[11px] text-indigo-600/80 dark:text-indigo-300/80 mt-2 pt-2 border-t border-indigo-100 dark:border-indigo-800/50" title="${baseline.description} · 기준 UPH ${baselineUph.toFixed(1)}개/시">📊 비교 기준: <strong>${baseline.description}</strong> · 기준 UPH <strong>${baselineUph.toFixed(1)}</strong>개/시 · 현재 UPH <strong>${avgUph.toFixed(1)}</strong></div>`
        : `<div class="text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700" title="${baseline.description}">📊 비교 기준: <strong>${baseline.description}</strong></div>`;

    let diagnosticHtml = '';
    if (!hasBaseline) {
        diagnosticHtml = `
            <div class="text-gray-700 mb-2">ℹ️ <strong class="font-bold text-lg">비교 기준 데이터 부족 — 절대치만 표시</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li>현재 기간 평균 UPH: <strong>${avgUph.toFixed(1)}</strong>개/시</li>
                <li>건당 총 출고 원가: <strong>${Math.round(unitCost).toLocaleString()}원</strong></li>
                <li><span class="font-bold text-gray-900">모니터링 대상:</span> <span class="bg-yellow-100 text-yellow-800 px-1 rounded">${lowestPart || '일부 파트'}</span> 파트의 처리량 추이를 관찰하세요.</li>
            </ul>
            ${baselineMetaHtml}
        `;
    } else if (oee < 80) {
        diagnosticHtml = `
            <div class="text-red-700 mb-2">⚠️ <strong class="font-bold text-lg">생산 효율 경고: 기준 대비 ${Math.round(100 - oee)}% 저하</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li><span class="font-bold text-gray-900">가장 취약한 파트:</span> <span class="bg-red-100 text-red-800 px-1 rounded">${lowestPart || '전반적'}</span> (현재 UPH: ${lowestUph === Infinity ? 0 : Math.round(lowestUph)})</li>
                <li><span class="font-bold text-gray-900">조치 권고사항:</span>
                    해당 파트에 <span class="text-blue-600 font-bold">인력을 추가 배치(1~2명)</span>하거나,
                    작업자들의 피로도를 고려하여 <span class="text-green-600 font-bold">10분간 강제 휴식</span>을 부여하세요.
                </li>
                <li>현재 건당 총 출고 원가가 <strong>${Math.round(unitCost).toLocaleString()}원</strong>입니다. 병목 해소가 시급합니다.</li>
            </ul>
            ${baselineMetaHtml}
        `;
    } else if (oee > 110) {
        diagnosticHtml = `
            <div class="text-blue-700 mb-2">🔥 <strong class="font-bold text-lg">상승세: 기준 대비 ${Math.round(oee - 100)}% 향상</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li>현재의 속도가 지속될 경우, 남은 업무량 대비 투입 인원이 남을 수 있습니다.</li>
                <li><span class="font-bold text-gray-900">조치 권고사항:</span> 작업 속도가 빠른 인원을 <span class="text-blue-600 font-bold">내일 업무 준비나 재고 조사 등</span> 다른 업무로 전환하여 유휴 시간을 줄이세요.</li>
                <li>건당 총 출고 원가가 <strong>${Math.round(unitCost).toLocaleString()}원</strong>으로 낮게 방어되어 수익성이 매우 좋습니다.</li>
            </ul>
            ${baselineMetaHtml}
        `;
    } else {
        diagnosticHtml = `
            <div class="text-green-700 mb-2">✅ <strong class="font-bold text-lg">평소 수준 (효율 ${Math.round(oee)}%)</strong></div>
            <ul class="list-disc pl-5 space-y-1 text-sm">
                <li>현재 UPH <strong>${avgUph.toFixed(1)}</strong> / 기준 UPH <strong>${baselineUph.toFixed(1)}</strong> — 평소 수준으로 안정적으로 운영 중입니다.</li>
                <li><span class="font-bold text-gray-900">모니터링 대상:</span> <span class="bg-yellow-100 text-yellow-800 px-1 rounded">${lowestPart || '일부 파트'}</span> 파트의 처리량이 약간 저하되고 있는지 지속 관찰하세요.</li>
            </ul>
            ${baselineMetaHtml}
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