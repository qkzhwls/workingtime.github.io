// === js/history-excel-work.js ===
import { appConfig, allHistoryData } from './state.js';
import { formatTimeTo24H, getWeekOfYear, showToast } from './utils.js';
import { fitToColumn, appendTotalRow } from './history-excel-utils.js';

export const downloadHistoryAsExcel = async (dateKey, format = 'xlsx') => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) ? allHistoryData[currentIndex + 1] : null;

        const workbook = XLSX.utils.book_new();
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) historyWageMap[pt.name] = pt.wage || 0;
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        const dailyRecords = data.workRecords || [];
        const dailyQuantities = data.taskQuantities || {};
        
        const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = dailyRecords.map(r => {
            const duration = Number(r.duration) || 0;
            const wage = combinedWageMap[r.member] || 0;
            return {
                '팀원': r.member || '', '업무 종류': r.task || '', '시작 시간': formatTimeTo24H(r.startTime),
                '종료 시간': formatTimeTo24H(r.endTime), '소요 시간(분)': Math.round(duration), '인건비(원)': Math.round((duration / 60) * wage)
            };
        });
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (${dateKey})`);

        if (format === 'xlsx') {
            let prevTaskSummary = {};
            if (previousDayData) {
                (previousDayData.workRecords || []).forEach(r => {
                    if (!prevTaskSummary[r.task]) prevTaskSummary[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                    const cost = ((Number(r.duration) || 0) / 60) * (combinedWageMap[r.member] || 0);
                    prevTaskSummary[r.task].totalDuration += (Number(r.duration) || 0);
                    prevTaskSummary[r.task].totalCost += cost;
                    prevTaskSummary[r.task].members.add(r.member);
                });
            }
            
            const summaryByTask = {};
            dailyRecords.forEach(r => {
                if (!summaryByTask[r.task]) summaryByTask[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                const cost = ((Number(r.duration) || 0) / 60) * (combinedWageMap[r.member] || 0);
                summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
                summaryByTask[r.task].totalCost += cost;
                summaryByTask[r.task].members.add(r.member); 
            });
            
            const sheet2Headers = ['업무 종류', '진행 인원수', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)', '진행 인원수(전일비)', '총 시간(전일비)', '총 인건비(전일비)', '총 처리량(전일비)', '개당 처리비용(전일비)'];
            const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
                const taskQty = Number(dailyQuantities[task]) || 0;
                const costPerItem = (taskQty > 0) ? (summaryByTask[task].totalCost / taskQty) : 0;
                const prevSummary = prevTaskSummary[task] || { totalDuration: 0, totalCost: 0, members: new Set() };
                const prevQty = Number(previousDayData?.taskQuantities?.[task]) || 0;
                const prevCostPerItem = (prevQty > 0) ? (prevSummary.totalCost / prevQty) : 0;

                return {
                    '업무 종류': task, '진행 인원수': summaryByTask[task].members.size, '총 소요 시간(분)': Math.round(summaryByTask[task].totalDuration), '총 인건비(원)': Math.round(summaryByTask[task].totalCost), '총 처리량(개)': taskQty, '개당 처리비용(원)': Math.round(costPerItem),
                    '진행 인원수(전일비)': summaryByTask[task].members.size - prevSummary.members.size, '총 시간(전일비)': Math.round(summaryByTask[task].totalDuration - prevSummary.totalDuration), '총 인건비(전일비)': Math.round(summaryByTask[task].totalCost - prevSummary.totalCost), '총 처리량(전일비)': taskQty - prevQty, '개당 처리비용(전일비)': Math.round(costPerItem - prevCostPerItem)
                };
            });
            
            const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
            if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); 
            fitToColumn(worksheet2);
            XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (${dateKey})`);

            const sheet3Headers = ['파트', '총 인건비(원)'];
            const memberToPartMap = new Map();
            (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
            const summaryByPart = {};
            dailyRecords.forEach(r => {
                const part = memberToPartMap.get(r.member) || '알바';
                if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
                summaryByPart[part].totalCost += ((Number(r.duration) || 0) / 60) * (combinedWageMap[r.member] || 0);
            });
            const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
                '파트': part, '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
            }));
            const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
            if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);
            fitToColumn(worksheet3);
            XLSX.utils.book_append_sheet(workbook, worksheet3, `파트 인건비 (${dateKey})`);
        }

        XLSX.writeFile(workbook, `업무기록_${dateKey}.${format}`);
    } catch (error) {
        console.error('Export failed:', error);
        showToast('파일 생성에 실패했습니다.', true);
    }
};

export const downloadPeriodHistoryAsExcel = async (startDate, endDate, customFileName = null, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    try {
        const filteredData = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
        if (filteredData.length === 0) return showToast('선택한 기간에 업무 데이터가 없습니다.', true);

        const workbook = XLSX.utils.book_new();
        const historyWageMap = { ...(appConfig.memberWages || {}) };

        const sheet1Headers = ['날짜', '팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = filteredData.flatMap(day => 
            (day.workRecords || []).map(r => {
                const duration = Number(r.duration) || 0;
                const wage = historyWageMap[r.member] || (appConfig.defaultPartTimerWage || 10000);
                return {
                    '날짜': day.id, '팀원': r.member || '', '업무 종류': r.task || '', '시작 시간': formatTimeTo24H(r.startTime),
                    '종료 시간': formatTimeTo24H(r.endTime), '소요 시간(분)': Math.round(duration), '인건비(원)': Math.round((duration / 60) * wage)
                };
            })
        ).sort((a,b) => a['날짜'].localeCompare(b['날짜']));

        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if(sheet1Data.length) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (기간)`);
        XLSX.writeFile(workbook, customFileName || `업무기록_기간_${startDate}_${endDate}.${format}`);
    } catch (error) {
        console.error('Period export failed:', error);
        showToast('기간 데이터 다운로드 실패', true);
    }
};

export const downloadPeriodWeekendAsExcel = (startDate, endDate, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    const dataList = allHistoryData.filter(d => {
        if (d.id < startDate || d.id > endDate) return false;
        const dayOfWeek = new Date(d.id + "T00:00:00").getDay();
        return dayOfWeek === 0 || dayOfWeek === 6; 
    });

    if (dataList.length === 0) return showToast('선택한 기간에 주말 근무 데이터가 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const historyWageMap = { ...(appConfig.memberWages || {}) };
    const sheet1Headers = ['날짜', '팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
    const sheet1Data = dataList.flatMap(day => 
        (day.workRecords || []).map(r => {
            const duration = Number(r.duration) || 0;
            const wage = historyWageMap[r.member] || (appConfig.defaultPartTimerWage || 10000);
            return {
                '날짜': day.id, '팀원': r.member || '', '업무 종류': r.task || '', '시작 시간': formatTimeTo24H(r.startTime), '종료 시간': formatTimeTo24H(r.endTime),
                '소요 시간(분)': Math.round(duration), '인건비(원)': Math.round((duration / 60) * wage)
            };
        })
    ).sort((a,b) => a['날짜'].localeCompare(b['날짜']));

    if (sheet1Data.length === 0) return showToast('해당 기간 주말에 상세 업무 기록이 없습니다.', true);

    const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
    appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
    fitToColumn(worksheet1);
    XLSX.utils.book_append_sheet(workbook, worksheet1, `주말 상세 기록`);
    XLSX.writeFile(workbook, `주말업무기록_기간_${startDate}_${endDate}.${format}`);
    showToast('기간별 주말기록 다운로드 완료');
};

export const downloadWeeklyHistoryAsExcel = async (weekKey, format = 'xlsx') => {
    if (!weekKey) return showToast('주간 정보가 없습니다.', true);
    const weekData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);
    if (weekData.length === 0) return showToast(`${weekKey} 데이터가 없습니다.`, true);
    weekData.sort((a, b) => a.id.localeCompare(b.id));
    await downloadPeriodHistoryAsExcel(weekData[0].id, weekData[weekData.length - 1].id, `주간업무요약_${weekKey}.${format}`, format);
};

export const downloadMonthlyHistoryAsExcel = async (monthKey, format = 'xlsx') => {
     if (!monthKey) return showToast('월간 정보가 없습니다.', true);
     const monthData = allHistoryData.filter(d => d.id.startsWith(monthKey));
     if (monthData.length === 0) return showToast(`${monthKey} 데이터가 없습니다.`, true);
     monthData.sort((a, b) => a.id.localeCompare(b.id));
     await downloadPeriodHistoryAsExcel(monthData[0].id, monthData[monthData.length - 1].id, `월간업무요약_${monthKey}.${format}`, format);
};