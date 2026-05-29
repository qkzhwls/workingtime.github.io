// === js/analysis-logic.js ===
// 설명: 순수 계산 및 분석 함수 모음입니다. (시뮬레이션, 병목 분석, 예측 등)

import * as State from './state.js';
import { formatDuration, getTodayDateString } from './utils.js';
import { calculateStandardThroughputs } from './ui-history-reports-logic.js';

/**
 * 누락된 처리량이 있는지 확인하는 함수
 */
export const checkMissingQuantities = (dayData) => {
    if (!dayData || !dayData.workRecords) return [];

    const records = dayData.workRecords;
    const quantities = dayData.taskQuantities || {};
    const confirmedZeroTasks = dayData.confirmedZeroTasks || [];

    const durationByTask = records.reduce((acc, r) => {
        if (r.task && r.duration > 0) {
            acc[r.task] = (acc[r.task] || 0) + r.duration;
        }
        return acc;
    }, {});

    const tasksWithDuration = Object.keys(durationByTask);
    if (tasksWithDuration.length === 0) return [];
    
    const quantityTaskTypes = (State.appConfig && State.appConfig.quantityTaskTypes) ? State.appConfig.quantityTaskTypes : [];
    const missingTasks = [];

    for (const task of tasksWithDuration) {
        if (quantityTaskTypes.includes(task)) {
            const quantity = Number(quantities[task]) || 0;
            if (quantity <= 0 && !confirmedZeroTasks.includes(task)) {
                missingTasks.push(task);
            }
        }
    }

    return missingTasks;
};

/**
 * 인건비 시뮬레이션 계산 로직
 */
export const calculateSimulation = (mode, task, targetQty, inputValue, startTimeStr = "09:00", includeLinkedTasks = true, manualSpeed = null) => {
    // mode: 'fixed-workers' | 'target-time'
    if (!task || targetQty <= 0 || inputValue <= 0) {
        return { error: "모든 값을 올바르게 입력해주세요." };
    }

    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    
    // 수동 입력된 속도가 있으면 우선 사용, 없으면 이력 기반 평균 속도 사용
    const speedPerPerson = (manualSpeed !== null && manualSpeed > 0) 
        ? Number(manualSpeed) 
        : (standards[task] || 0); // (개/분/인)

    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);
    const linkedTaskAvgDuration = includeLinkedTasks ? (linkedAvgDurations[task] || 0) : 0; // (분/건)
    const linkedTaskName = currentAppConfig.simulationTaskLinks ? currentAppConfig.simulationTaskLinks[task] : null;

    if (speedPerPerson <= 0) {
        return { error: "해당 업무의 과거 이력 데이터가 부족하여 예측할 수 없습니다. (속도를 직접 입력해보세요)" };
    }

    const avgWagePerMinute = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    
    // '주업무'에 필요한 총 *맨-분* (Man-Minutes)
    const totalManMinutesForMainTask = targetQty / speedPerPerson;
    
    let relatedTaskInfo = null;
    if (linkedTaskName) {
        relatedTaskInfo = {
            name: linkedTaskName,
            time: linkedTaskAvgDuration 
        };
    }

    let result = {
        speed: speedPerPerson,
        relatedTaskInfo: relatedTaskInfo 
    };

    if (mode === 'fixed-workers') {
        result.workerCount = inputValue; // 예: 5명

        // 1. 주 업무에 걸리는 시간
        const durationForMainTask = totalManMinutesForMainTask / result.workerCount; 
        
        // 2. 최종 소요 시간 = (주 업무 시간) + (사전 작업 고정 시간)
        result.durationMinutes = durationForMainTask + linkedTaskAvgDuration; 

        // 3. 총 비용 계산
        const totalManMinutesNeeded = result.durationMinutes * result.workerCount; 
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;

        result.label1 = '예상 소요 시간';
        result.value1 = formatDuration(result.durationMinutes);

        // 휴게시간(12:30~13:30) 고려한 종료 시간 예측
        const now = new Date();
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        let endDateTime = new Date(startDateTime.getTime() + result.durationMinutes * 60000);

        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             result.durationMinutes += 60; // 실제 소요 시간에 점심시간 포함
             result.value1 = `${formatDuration(result.durationMinutes)} (점심포함)`;
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000); 
             result.includesLunch = true; 
        } else {
             result.includesLunch = false;
        }
        
        result.expectedEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;

    } else if (mode === 'target-time') {
        result.durationMinutes = inputValue;
        
        const effectiveDuration = inputValue - linkedTaskAvgDuration; // 목표시간 - 사전작업 고정시간
        if (effectiveDuration <= 0) {
            return { error: "목표 시간이 사전 작업 시간보다 짧아 계산할 수 없습니다." };
        }
        
        // 필요 인원을 정수로 올림 처리
        result.workerCount = Math.ceil(totalManMinutesForMainTask / effectiveDuration);
        
        result.label1 = '필요 인원';
        result.value1 = `${result.workerCount} 명`;
        
        const totalManMinutesNeeded = result.durationMinutes * result.workerCount;
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;

        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const now = new Date();
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        let endDateTime = new Date(startDateTime.getTime() + inputValue * 60000);
        
        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000);
             result.includesLunch = true;
        } else {
             result.includesLunch = false;
        }

        result.expectedEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;
    }

    return result;
};

/**
 * 효율 곡선 차트 데이터 생성
 */
export const generateEfficiencyChartData = (task, targetQty, historyData) => {
    const standards = calculateStandardThroughputs(historyData);
    const speedPerPerson = standards[task] || 0;
    if (speedPerPerson <= 0) return null;

    const totalManMinutes = targetQty / speedPerPerson;
    const labels = [];
    const data = [];

    for (let workers = 1; workers <= 15; workers++) {
        labels.push(`${workers}명`);
        data.push(Math.round(totalManMinutes / workers));
    }

    return { labels, data, taskName: task };
};

/**
 * 병목 구간 분석 로직
 */
export const analyzeBottlenecks = (historyData) => {
    const standards = calculateStandardThroughputs(historyData);
    const ranked = Object.entries(standards)
        .map(([task, speed]) => ({
            task,
            speed,
            timeFor1000: (speed > 0) ? (1000 / speed) : 0 // 1000개 처리 시 필요 시간 (1인 기준)
        }))
        .filter(item => item.speed > 0)
        .sort((a, b) => b.timeFor1000 - a.timeFor1000) 
        .slice(0, 5); 

    return ranked;
};

/**
 * 연관 업무의 '건당 평균 시간' (분/건) 계산 헬퍼
 */
const calculateLinkedTaskAverageDuration = (allHistoryData, appConfig) => {
    const links = (appConfig && appConfig.simulationTaskLinks) ? appConfig.simulationTaskLinks : {};
    const mainTasks = Object.keys(links);
    if (mainTasks.length === 0 || !allHistoryData) return {};

    const linkedTasks = new Set(Object.values(links));
    const taskStats = {}; // { duration: 총 시간, count: 총 횟수 }

    allHistoryData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            if (linkedTasks.has(r.task)) {
                if (!taskStats[r.task]) {
                    taskStats[r.task] = { duration: 0, count: 0 };
                }
                taskStats[r.task].duration += (r.duration || 0);
                taskStats[r.task].count += 1;
            }
        });
    });

    const avgDurations = {}; 
    Object.entries(taskStats).forEach(([taskName, stats]) => {
        if (stats.count > 0) {
            avgDurations[taskName] = stats.duration / stats.count; 
        }
    });

    const mainTaskAvgDurations = {};
    for (const mainTask of mainTasks) {
        const linkedTaskName = links[mainTask];
        if (avgDurations[linkedTaskName]) {
            mainTaskAvgDurations[mainTask] = avgDurations[linkedTaskName];
        }
    }
    return mainTaskAvgDurations;
};

/**
 * 선형 회귀 분석을 통한 미래 데이터 예측 함수
 * @param {Array} historyData - 전체 이력 데이터
 * @param {number} daysToPredict - 예측할 미래 일수 (기본 14일)
 */
export const predictFutureTrends = (historyData, daysToPredict = 14) => {
    // 1. 데이터 전처리 (날짜순 정렬 및 최근 90일 데이터 사용)
    const sortedData = [...historyData]
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(-90); 

    if (sortedData.length < 5) return null; // 데이터 부족 시 예측 불가

    const labels = [];
    const revenueData = [];
    const deliveryData = [];

    const firstDate = new Date(sortedData[0].id).getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    const pointsRevenue = [];
    const pointsDelivery = [];

    sortedData.forEach(day => {
        const dateObj = new Date(day.id);
        const x = (dateObj.getTime() - firstDate) / oneDay; 
        
        const rev = Number(day.management?.revenue) || 0;
        const del = Number(day.taskQuantities?.['국내배송']) || 0;

        // 0이 아닌 값만 추세선 계산에 반영 (주말 등 제외)
        if (rev > 0) pointsRevenue.push({ x, y: rev });
        if (del > 0) pointsDelivery.push({ x, y: del });

        labels.push(day.id.substring(5)); // MM-DD
        revenueData.push(rev);
        deliveryData.push(del);
    });

    // 2. 선형 회귀 계산 (y = mx + b)
    const calculateRegression = (points) => {
        const n = points.length;
        if (n === 0) return { m: 0, b: 0 };

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        points.forEach(p => {
            sumX += p.x;
            sumY += p.y;
            sumXY += (p.x * p.y);
            sumXX += (p.x * p.x);
        });

        const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const b = (sumY - m * sumX) / n;
        return { m, b };
    };

    const regRevenue = calculateRegression(pointsRevenue);
    const regDelivery = calculateRegression(pointsDelivery);

    // 3. 미래 데이터 생성
    const futureLabels = [];
    const predictedRevenue = [];
    const predictedDelivery = [];
    
    const lastRealX = (new Date(sortedData[sortedData.length - 1].id).getTime() - firstDate) / oneDay;

    // ✅ [수정] i = 0 (오늘)부터 시작하도록 변경하여 오늘 예측값 포함
    for (let i = 0; i <= daysToPredict; i++) {
        const futureX = lastRealX + i;
        const futureDate = new Date(firstDate + (futureX * oneDay));
        const dateStr = futureDate.toISOString().slice(5, 10);
        
        const dayNum = futureDate.getDay();
        const isWeekend = (dayNum === 0 || dayNum === 6);

        let predRev = regRevenue.m * futureX + regRevenue.b;
        let predDel = regDelivery.m * futureX + regDelivery.b;

        predRev = Math.max(0, predRev);
        predDel = Math.max(0, predDel);

        // 주말 보정 (0 처리)
        if (isWeekend) {
            predRev = 0; 
            predDel = 0;
        }

        futureLabels.push(dateStr);
        predictedRevenue.push(Math.round(predRev));
        predictedDelivery.push(Math.round(predDel));
    }

    return {
        historical: {
            labels,
            revenue: revenueData,
            delivery: deliveryData
        },
        prediction: {
            labels: futureLabels,
            revenue: predictedRevenue,
            delivery: predictedDelivery
        },
        trend: {
            revenueSlope: regRevenue.m,
            deliverySlope: regDelivery.m
        }
    };
};