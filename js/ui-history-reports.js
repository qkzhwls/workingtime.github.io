// === js/ui-history-reports.js ===
import { getWeekOfYear } from './utils.js';

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    calculateStandardThroughputs,
    analyzeRevenueBasedStaffing,
    analyzeRevenueWorkloadTrend,
    calculateAdvancedProductivity,
    calculateBenchmarkOEE,
    calculateAverageStaffing
} from './ui-history-reports-logic.js';

import {
    renderGenericReport
} from './ui-history-reports-renderer.js';


const _prepareReportData = (currentDaysData, previousDaysData, appConfig) => {
    const wageMap = { ...(appConfig.memberWages || {}) };
    [...currentDaysData, ...previousDaysData].forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    });

    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    return { wageMap, memberToPartMap };
};

const _calculateAverageActiveMembers = (daysData, appConfig, wageMap) => {
    if (!daysData || daysData.length === 0) return 0;
    const workingDays = daysData.filter(d => d.workRecords && d.workRecords.length > 0);
    if (workingDays.length === 0) return 0;

    const totalActive = workingDays.reduce((sum, day) => {
        return sum + calculateReportKPIs(day, appConfig, wageMap).activeMembersCount;
    }, 0);
    return totalActive / workingDays.length;
};


export const renderReportDaily = (dateKey, allHistoryData, appConfig, context) => {
    const view = document.getElementById('report-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">일별 리포트 집계 중...</div>';

    context.currentReportParams = { dateKey, allHistoryData, appConfig };

    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-gray-500">데이터 없음</div>';
        return;
    }

    const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
    const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length)
                                ? allHistoryData[currentIndex + 1]
                                : null;

    const { wageMap, memberToPartMap } = _prepareReportData([data], [previousDayData].filter(Boolean), appConfig);

    const todayKPIs = calculateReportKPIs(data, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(data, appConfig, wageMap, memberToPartMap);

    const prevKPIs = calculateReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);

    const todayAvgStaff = calculateAverageStaffing([data]);
    const prevAvgStaff = previousDayData ? calculateAverageStaffing([previousDayData]) : {};

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    const todayStaffing = calculateAdvancedProductivity([data], todayAggr, standardThroughputs, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity([previousDayData].filter(Boolean), prevAggr, standardThroughputs, appConfig, wageMap);

    const benchmarkOEE = calculateBenchmarkOEE(allHistoryData, appConfig);

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'daily',
        title: `${dateKey} 업무 리포트`,
        tData: { raw: data, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs
    };

    renderGenericReport(
        'report-daily-view',
        `${dateKey} 업무 리포트 (이전 기록 대비)`,
        { raw: data, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '기록',
        0,
        benchmarkOEE,
        standardThroughputs
    );
};

export const renderReportWeekly = (weekKey, allHistoryData, appConfig, context) => {
    const view = document.getElementById('report-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 리포트 집계 중...</div>';

    context.currentReportParams = { weekKey, allHistoryData, appConfig };

    const currentWeekDays = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);

    const sortedWeeks = Array.from(new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedWeeks.indexOf(weekKey);
    const prevWeekKey = (currentIndex > -1 && currentIndex + 1 < sortedWeeks.length) ? sortedWeeks[currentIndex + 1] : null;
    const prevWeekDays = prevWeekKey ? allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === prevWeekKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentWeekDays, prevWeekDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentWeekDays, weekKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevWeekDays, prevWeekKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentWeekDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevWeekDays, appConfig, wageMap);

    const todayAvgStaff = calculateAverageStaffing(currentWeekDays);
    const prevAvgStaff = calculateAverageStaffing(prevWeekDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    const todayStaffing = calculateAdvancedProductivity(currentWeekDays, todayAggr, standardThroughputs, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevWeekDays, prevAggr, standardThroughputs, appConfig, wageMap);
    
    const benchmarkOEE = calculateBenchmarkOEE(allHistoryData, appConfig);

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'weekly',
        title: `${weekKey} 주별 업무 리포트`,
        tData: { raw: todayData, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs
    };

    renderGenericReport(
        'report-weekly-view',
        `${weekKey} 주별 업무 리포트 (이전 주 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '주',
        0,
        benchmarkOEE,
        standardThroughputs
    );
};

export const renderReportMonthly = (monthKey, allHistoryData, appConfig, context) => {
    const view = document.getElementById('report-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 리포트 집계 중...</div>';

    context.currentReportParams = { monthKey, allHistoryData, appConfig };

    const currentMonthDays = allHistoryData.filter(d => d.id.substring(0, 7) === monthKey);

    const sortedMonths = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 7)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedMonths.indexOf(monthKey);
    const prevMonthKey = (currentIndex > -1 && currentIndex + 1 < sortedMonths.length) ? sortedMonths[currentIndex + 1] : null;
    const prevMonthDays = prevMonthKey ? allHistoryData.filter(d => d.id.substring(0, 7) === prevMonthKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentMonthDays, prevMonthDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentMonthDays, monthKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevMonthDays, prevMonthKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentMonthDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevMonthDays, appConfig, wageMap);

    const todayAvgStaff = calculateAverageStaffing(currentMonthDays);
    const prevAvgStaff = calculateAverageStaffing(prevMonthDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    const todayStaffing = calculateAdvancedProductivity(currentMonthDays, todayAggr, standardThroughputs, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevMonthDays, prevAggr, standardThroughputs, appConfig, wageMap);

    context.monthlyRevenues = context.monthlyRevenues || {};
    const currentRevenue = context.monthlyRevenues[monthKey] || 0;
    const prevRevenue = prevMonthKey ? (context.monthlyRevenues[prevMonthKey] || 0) : 0;

    const revenueAnalysis = analyzeRevenueBasedStaffing(
        currentRevenue,
        todayStaffing.totalStandardMinutesNeeded,
        todayKPIs.activeMembersCount,
        todayKPIs.totalDuration,
        appConfig
    );

    const revenueTrendAnalysis = analyzeRevenueWorkloadTrend(
        currentRevenue,
        prevRevenue,
        todayStaffing.totalStandardMinutesNeeded,
        prevStaffing.totalStandardMinutesNeeded
    );
    
    const benchmarkOEE = calculateBenchmarkOEE(allHistoryData, appConfig);

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'monthly',
        title: `${monthKey} 월별 업무 리포트`,
        tData: { raw: todayData, memberToPartMap, revenue: currentRevenue },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, revenueAnalysis, revenueTrend: revenueTrendAnalysis },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs
    };

    renderGenericReport(
        'report-monthly-view',
        `${monthKey} 월별 업무 리포트 (이전 월 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap, revenue: currentRevenue },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, revenueAnalysis: revenueAnalysis, revenueTrend: revenueTrendAnalysis },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '월',
        prevRevenue,
        benchmarkOEE,
        standardThroughputs
    );
};

export const renderReportYearly = (yearKey, allHistoryData, appConfig, context) => {
    const view = document.getElementById('report-yearly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">연간 리포트 집계 중...</div>';

    context.currentReportParams = { yearKey, allHistoryData, appConfig };

    const currentYearDays = allHistoryData.filter(d => d.id.substring(0, 4) === yearKey);

    const sortedYears = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 4)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedYears.indexOf(yearKey);
    const prevYearKey = (currentIndex > -1 && currentIndex + 1 < sortedYears.length) ? sortedYears[currentIndex + 1] : null;
    const prevYearDays = prevYearKey ? allHistoryData.filter(d => d.id.substring(0, 4) === prevYearKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentYearDays, prevYearDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentYearDays, yearKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevYearDays, prevYearKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentYearDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevYearDays, appConfig, wageMap);

    const todayAvgStaff = calculateAverageStaffing(currentYearDays);
    const prevAvgStaff = calculateAverageStaffing(prevYearDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    const todayStaffing = calculateAdvancedProductivity(currentYearDays, todayAggr, standardThroughputs, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevYearDays, prevAggr, standardThroughputs, appConfig, wageMap);

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'yearly',
        title: `${yearKey} 연간 업무 리포트`,
        tData: { raw: todayData, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs
    };

    renderGenericReport(
        'report-yearly-view',
        `${yearKey} 연간 업무 리포트 (이전 연도 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '연도',
        0,
        null,
        standardThroughputs
    );
};