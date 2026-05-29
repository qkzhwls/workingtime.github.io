// === js/ui-history-reports-productivity.js ===
import { isWeekday, getTodayDateString } from './utils.js';
import { getAsArray } from './ui-history-reports-utils.js';
import { calculateReportKPIs, calculateReportAggregations, calculateStandardThroughputs } from './ui-history-reports-calculations.js';

export const calculateBenchmarkOEE = (allHistoryData, appConfig) => {
    if (!allHistoryData || allHistoryData.length === 0) return null;
    const recentData = [...allHistoryData].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
    if (recentData.length === 0) return null;

    let totalOEE = 0;
    let validDays = 0;
    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    recentData.forEach(day => {
        const wageMap = { ...(appConfig.memberWages || {}) };
        getAsArray(day.partTimers).forEach(pt => { if (pt && pt.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0; });
        const dayAggr = calculateReportAggregations(day, appConfig, wageMap, new Map());
        const productivity = calculateAdvancedProductivity([day], dayAggr, standardThroughputs, appConfig, wageMap);
        if (productivity.oee > 0) {
            totalOEE += productivity.oee;
            validDays++;
        }
    });

    return validDays > 0 ? (totalOEE / validDays) : null;
};

export const analyzeRevenueBasedStaffing = (revenue, totalStandardMinutesNeeded, activeMembersCount, actualTotalDuration, appConfig) => {
     if (!revenue || revenue <= 0 || !totalStandardMinutesNeeded || totalStandardMinutesNeeded <= 0 || !actualTotalDuration || actualTotalDuration <= 0 || !activeMembersCount || activeMembersCount <= 0) {
        return null;
    }
    const revenueUnit = appConfig.revenueIncrementUnit || 10000000;
    const actualMinutesPerPerson = actualTotalDuration / activeMembersCount;
    const minutesPerRevenue = totalStandardMinutesNeeded / revenue;
    const minutesPerUnitIncrease = minutesPerRevenue * revenueUnit;
    const staffNeededPerUnitIncrease = minutesPerUnitIncrease / actualMinutesPerPerson;
    return {
        minutesPerRevenue,
        staffNeededPerUnitIncrease,
        actualMinutesPerPerson,
        revenueUnit,
        formattedUnit: (revenueUnit / 10000000 >= 1) ? `${revenueUnit / 10000000}천만원` : `${revenueUnit.toLocaleString()}원`
    };
};

export const analyzeRevenueWorkloadTrend = (currentRevenue, prevRevenue, currentWorkload, prevWorkload) => {
    if (!currentRevenue || !prevRevenue || !currentWorkload || !prevWorkload) return null;
    const revenueChangeRate = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
    const workloadChangeRate = ((currentWorkload - prevWorkload) / prevWorkload) * 100;
    const gap = workloadChangeRate - revenueChangeRate;
    let diagnosis = '';
    let colorClass = '';
    if (gap > 10) {
        diagnosis = '⚠️ 수익성 경고: 매출 대비 업무량 급증'; colorClass = 'text-red-600';
    } else if (gap > 5) {
        diagnosis = '📉 효율 저하: 업무량이 매출보다 더 빠르게 증가 중'; colorClass = 'text-orange-600';
    } else if (gap < -10) {
        diagnosis = '🚀 수익성 대폭 개선: 매출 급증에도 업무량은 안정적'; colorClass = 'text-blue-600';
    } else if (gap < -5) {
        diagnosis = '📈 효율 개선: 매출 증가폭이 업무량 증가폭을 상회'; colorClass = 'text-green-600';
    } else {
        diagnosis = '✅ 균형 성장: 매출과 업무량이 비례하여 증가'; colorClass = 'text-gray-800';
    }
    return { revenueChangeRate, workloadChangeRate, gap, diagnosis, colorClass };
};

export const analyzeUnitCost = (data, appConfig, wageMap, totalRevenue = 0) => {
    const costCalcTasks = new Set(appConfig.costCalcTasks || []);
    const fixedMaterialCost = Number(appConfig.fixedMaterialCost) || 0;
    const fixedShippingCost = Number(appConfig.fixedShippingCost) || 0;
    const fixedDirectDeliveryCost = Number(appConfig.fixedDirectDeliveryCost) || 0;

    let targetLaborCost = 0;
    let maxTaskQuantity = 0;
    
    const records = getAsArray(data.workRecords);
    const quantities = data.taskQuantities || {};

    records.forEach(r => {
        if (costCalcTasks.has(r.task)) {
            const duration = Number(r.duration) || 0;
            const wage = wageMap[r.member] || 0;
            targetLaborCost += (duration / 60) * wage;
        }
    });

    costCalcTasks.forEach(task => {
        const qty = Number(quantities[task]) || 0;
        if (qty > maxTaskQuantity) maxTaskQuantity = qty;
    });

    const perItemLaborCost = maxTaskQuantity > 0 ? (targetLaborCost / maxTaskQuantity) : 0;

    const directDeliveryRecords = records.filter(r => r.task === '직진배송');
    const uniqueDates = new Set();
    
    directDeliveryRecords.forEach(r => {
        const d = r.date || data.id;
        if (d) uniqueDates.add(d);
    });
    
    const directDeliveryCount = uniqueDates.size;
    const totalDirectCost = directDeliveryCount * fixedDirectDeliveryCost;
    const perItemDirectCost = maxTaskQuantity > 0 ? (totalDirectCost / maxTaskQuantity) : 0;

    const totalUnitCost = perItemLaborCost + fixedMaterialCost + fixedShippingCost + perItemDirectCost;

    let salesCount = Number(data.management?.orderCount) || 0;
    if (salesCount === 0) salesCount = maxTaskQuantity;

    let revenuePerItem = 0;
    let margin = 0;
    let marginRate = 0;

    if (salesCount > 0 && totalRevenue > 0) {
        revenuePerItem = totalRevenue / salesCount;
        margin = revenuePerItem - totalUnitCost;
        marginRate = (margin / revenuePerItem) * 100;
    }

    return {
        targetTasks: Array.from(costCalcTasks),
        baseQuantity: salesCount,
        costs: {
            labor: perItemLaborCost,
            material: fixedMaterialCost,
            shipping: fixedShippingCost,
            directDelivery: perItemDirectCost, 
            directDeliveryCount: directDeliveryCount, 
            total: totalUnitCost
        },
        profit: {
            revenuePerItem,
            margin,
            marginRate
        },
        isValid: costCalcTasks.size > 0 && (salesCount > 0 || maxTaskQuantity > 0)
    };
};

export const calculateAdvancedProductivity = (daysData, currentDataAggr, standardThroughputs, appConfig, wageMap) => {
    let totalStandardAvailableMinutes = 0;
    let totalActualWorkedMinutes = 0;
    let totalStandardMinutesNeeded = 0;
    let totalQualityCost = 0;
    let totalActualCost = 0;
    let totalActiveStaffSum = 0;
    let workingDaysCount = 0;

    const qualityTasksStr = new Set(appConfig.qualityCostTasks || []);
    const qualityLossTasks = [];

    daysData.forEach(day => {
        const workRecords = getAsArray(day.workRecords);
        if (workRecords.length > 0) {
            workingDaysCount++;
            const kpis = calculateReportKPIs(day, appConfig, wageMap);
            const activeStaff = kpis.activeMembersCount;

            if (activeStaff > 0) {
                totalActiveStaffSum += activeStaff;
                totalActualWorkedMinutes += kpis.totalDuration;
                totalActualCost += kpis.totalCost;
                totalQualityCost += kpis.totalQualityCost;

                const standardHours = appConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 };
                const hoursPerPerson = isWeekday(day.id) ? (standardHours.weekday || 8) : (standardHours.weekend || 4);
                totalStandardAvailableMinutes += (activeStaff * hoursPerPerson * 60);
            }
        }
    });

    const taskPerformanceLosses = [];

    Object.entries(currentDataAggr.taskSummary).forEach(([task, summary]) => {
        const actualQty = summary.quantity || 0;
        const stdSpeed = standardThroughputs[task];
        
        let standardMinutes = 0;
        if (actualQty > 0 && stdSpeed > 0) {
            standardMinutes = (actualQty / stdSpeed);
            totalStandardMinutesNeeded += standardMinutes;
        } else if (summary.duration > 0) {
            standardMinutes = summary.duration;
            totalStandardMinutesNeeded += summary.duration;
        }

        if (stdSpeed > 0 && summary.duration > standardMinutes) {
             taskPerformanceLosses.push({
                 task: task,
                 lossMinutes: summary.duration - standardMinutes,
                 actualSpeed: (summary.avgThroughput || 0).toFixed(2),
                 stdSpeed: stdSpeed.toFixed(2)
             });
        }

        if (qualityTasksStr.has(task) && summary.cost > 0) {
            qualityLossTasks.push({ task: task, cost: summary.cost });
        }
    });

    const utilizationRate = totalStandardAvailableMinutes > 0 ? (totalActualWorkedMinutes / totalStandardAvailableMinutes) * 100 : 0;
    const efficiencyRatio = totalActualWorkedMinutes > 0 ? (totalStandardMinutesNeeded / totalActualWorkedMinutes) * 100 : 0;
    const qualityRatio = totalActualCost > 0 ? ((totalActualCost - totalQualityCost) / totalActualCost) * 100 : 100;
    const oee = (utilizationRate / 100) * (efficiencyRatio / 100) * (qualityRatio / 100) * 100;

    const avgActiveStaff = workingDaysCount > 0 ? totalActiveStaffSum / workingDaysCount : 0;
    const availableFTE = avgActiveStaff;
    const workedFTE = availableFTE * (utilizationRate / 100);
    const requiredFTE = workedFTE * (efficiencyRatio / 100);
    const qualityFTE = requiredFTE * (qualityRatio / 100);

    const avgCostPerMinute = totalActualWorkedMinutes > 0 ? totalActualCost / totalActualWorkedMinutes : 0;
    const availabilityLossMinutes = Math.max(0, totalStandardAvailableMinutes - totalActualWorkedMinutes);
    const performanceLossMinutes = Math.max(0, totalActualWorkedMinutes - totalStandardMinutesNeeded);
    const availabilityLossCost = availabilityLossMinutes * avgCostPerMinute;
    const performanceLossCost = performanceLossMinutes * avgCostPerMinute;
    const qualityLossCost = totalQualityCost;
    const totalLossCost = availabilityLossCost + performanceLossCost + qualityLossCost;

    const topPerformanceLossTasks = taskPerformanceLosses.sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, 3);
    const topQualityLossTasks = qualityLossTasks.sort((a, b) => b.cost - a.cost).slice(0, 3);

    return {
        utilizationRate, efficiencyRatio, qualityRatio, oee,
        availableFTE, workedFTE, requiredFTE, qualityFTE,
        totalLossCost, availabilityLossCost, performanceLossCost, qualityLossCost,
        totalStandardAvailableMinutes, totalActualWorkedMinutes, totalStandardMinutesNeeded,
        topPerformanceLossTasks, topQualityLossTasks, avgCostPerMinute
    };
};

export const PRODUCTIVITY_METRIC_DESCRIPTIONS = {
    utilizationRate: {
        title: "시간 활용률 (Availability)",
        desc: "표준 근무 시간(평일 8H, 주말 4H) 대비 실제 업무 수행 시간의 비율입니다. 낮으면 대기 시간이 많았음을, 100% 초과는 야근/특근이 발생했음을 의미합니다."
    },
    efficiencyRatio: {
        title: "업무 효율성 (Performance)",
        desc: "표준 속도 대비 실제 작업 속도의 비율입니다. 100%보다 높으면 표준보다 빠르게, 낮으면 느리게 작업했음을 의미합니다."
    },
    qualityRatio: {
        title: "품질 효율 (Quality)",
        desc: "전체 투입된 노력 중 재작업(COQ)을 제외한 유효한 성과의 비율입니다. (100% - COQ비율)과 유사합니다."
    },
    oee: {
        title: "종합 생산 효율 (OEE)",
        desc: "시간 활용률 × 업무 효율성 × 품질 효율. 팀의 전반적인 생산성 수준을 나타내는 최종 지표입니다."
    },
    availableFTE: {
        title: "총 투입 인력",
        desc: "기간 내 실제로 출근하여 근무한 연인원의 평균입니다."
    },
    workedFTE: {
        title: "실제 작업 인력",
        desc: "출근한 인원 중 실제로 업무를 수행하고 있던 시간만을 인원수로 환산한 값입니다."
    },
    requiredFTE: {
        title: "표준 필요 인력",
        desc: "실제 수행한 업무량을 우리 팀의 표준 속도로 처리했을 때 필요한 이론적인 인원수입니다."
    },
    qualityFTE: {
        title: "최종 유효 인력",
        desc: "재작업 등으로 낭비된 인력을 제외하고, 최종적으로 가치 있는 성과를 낸 실질 인력 규모입니다."
    }
};

export const generateProductivityDiagnosis = (metrics, prevMetrics, benchmarkOEE = null) => {
    if (!metrics) return null;
    const { utilizationRate, efficiencyRatio, qualityRatio, oee } = metrics;
    
    let diagnosis = { icon: '✅', title: '최적 상태 유지', desc: '업무 시간과 속도 모두 적절한 균형을 유지하고 있습니다.', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
    const isOverloaded = utilizationRate >= 100;
    const isUnderloaded = utilizationRate <= 80;
    const isFast = efficiencyRatio >= 110;
    const isSlow = efficiencyRatio <= 90;

    if (isOverloaded && isFast) {
        diagnosis = { icon: '🔥', title: '극한 과부하 (Burnout 위험)', desc: '절대적인 시간이 부족한 와중에도 매우 빠르게 일하고 있습니다. 인원 충원이 시급합니다.', color: 'text-red-700', bg: 'bg-red-50 border-red-200' };
    } else if (isOverloaded && isSlow) {
        diagnosis = { icon: '💦', title: '비효율적 과로', desc: '장시간 근무하고 있지만 실제 처리 속도는 느립니다. 업무 프로세스 점검이나 교육이 필요합니다.', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' };
    } else if (isOverloaded) {
         diagnosis = { icon: '⏰', title: '시간 부족 (과부하)', desc: '표준 근무 시간을 초과하여 업무 수행. 업무량 조절 필요.', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' };
    } else if (isUnderloaded && isFast) {
        diagnosis = { icon: '⚡', title: '유휴 인력 발생 (고숙련)', desc: '업무를 빨리 끝내고 남는 시간이 많습니다. 인원 효율화 가능.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isUnderloaded && isSlow) {
        diagnosis = { icon: '⚠️', title: '생산성 저하', desc: '시간적 여유가 있음에도 업무 속도가 느립니다.', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300' };
    } else if (isUnderloaded) {
         diagnosis = { icon: '☕', title: '시간 여유', desc: '표준 시간 대비 실제 업무 수행 시간이 적습니다.', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' };
    } else if (isFast) {
         diagnosis = { icon: '🚀', title: '고효율 상태', desc: '적절한 시간 내에서 표준보다 빠르게 성과를 냅니다.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isSlow) {
         diagnosis = { icon: '🐢', title: '속도 개선 필요', desc: '시간은 적절하나 다소 느립니다.', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' };
    }

    let comments = [];
    if (utilizationRate >= 105) comments.push(`팀원들이 표준 근무 시간보다 <strong>약 ${(utilizationRate - 100).toFixed(0)}% 더 많이</strong> 일했습니다.`);
    else if (utilizationRate <= 75) comments.push(`근무 시간 중 <strong>약 ${(100 - utilizationRate).toFixed(0)}%가 대기 시간</strong> 등으로 활용되지 못했습니다.`);
    else comments.push(`근무 시간 활용률은 <strong>${utilizationRate.toFixed(0)}%</strong>로 적정 수준입니다.`);

    if (efficiencyRatio >= 115) comments.push(`표준 속도보다 <strong>${(efficiencyRatio - 100).toFixed(0)}% 더 빠르게</strong> 처리했습니다.`);
    else if (efficiencyRatio <= 85) comments.push(`표준 대비 <strong>속도가 다소 저하(${(100 - efficiencyRatio).toFixed(0)}% 느림)</strong>되었습니다.`);

    if (qualityRatio < 95) comments.push(`재작업 등으로 인한 <strong>품질 손실이 약 ${(100 - qualityRatio).toFixed(1)}%</strong> 발생했습니다.`);

    if (oee >= 85) comments.push(`종합적으로 <strong>매우 우수한 생산성(OEE ${oee.toFixed(0)}%)</strong>을 기록했습니다. 👏`);
    else if (oee <= 60) comments.push(`전반적인 생산성 지표가 낮습니다. 원인 분석이 필요합니다.`);

    if (benchmarkOEE !== null && benchmarkOEE > 0) {
        const diff = oee - benchmarkOEE;
        if (diff >= 5) comments.push(`📉 최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)보다 <strong>${diff.toFixed(0)}%p 더 높은</strong> 우수한 성과입니다!`);
        else if (diff <= -5) comments.push(`📉 최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)에 비해 <strong>${Math.abs(diff).toFixed(0)}%p 낮습니다.</strong>`);
        else comments.push(`평소 수준(최근 30일 평균 ${benchmarkOEE.toFixed(0)}%)을 유지했습니다.`);
    }

    return { diagnosis, commentHtml: comments.join('<br>') };
};

export const calculateSimulationThroughputs = (allHistoryData) => {
    const todayKey = getTodayDateString();
    const todayDate = new Date(todayKey + 'T00:00:00');
    
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);
    
    const twoMonthsAgoDate = new Date(yesterdayDate);
    twoMonthsAgoDate.setMonth(twoMonthsAgoDate.getMonth() - 2);
    const twoMonthsAgoKey = twoMonthsAgoDate.toISOString().slice(0, 10);

    const pastTwoMonthsData = allHistoryData.filter(d => d.id >= twoMonthsAgoKey && d.id <= yesterdayKey);

    const taskDailySpeeds = {};

    pastTwoMonthsData.forEach(day => {
        const records = getAsArray(day.workRecords);
        const quantities = day.taskQuantities || {};
        const dailyTaskStats = {};

        records.forEach(r => {
            const duration = Number(r.duration) || 0;
            if (r.task && duration > 0) {
                if (!dailyTaskStats[r.task]) dailyTaskStats[r.task] = { duration: 0, quantity: 0 };
                dailyTaskStats[r.task].duration += duration;
            }
        });

        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!dailyTaskStats[task]) dailyTaskStats[task] = { duration: 0, quantity: 0 };
                dailyTaskStats[task].quantity += q;
            }
        });

        Object.entries(dailyTaskStats).forEach(([task, stats]) => {
            if (stats.duration >= 10 && stats.quantity > 0) { 
                const speed = stats.quantity / stats.duration;
                if (!taskDailySpeeds[task]) taskDailySpeeds[task] = [];
                taskDailySpeeds[task].push(speed);
            }
        });
    });

    const standards = {};
    Object.keys(taskDailySpeeds).forEach(task => {
        const speeds = taskDailySpeeds[task];
        if (speeds.length > 0) {
            const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            standards[task] = avg;
        } else {
            standards[task] = 0;
        }
    });
    return standards;
};