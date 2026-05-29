// === js/history-excel-reports.js ===
import { formatDuration, formatTimeTo24H, showToast } from './utils.js';
import { fitToColumn } from './history-excel-utils.js';

export const downloadReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { title, tMetrics, tData } = reportData;

        const taskSummary = tMetrics.aggr.taskSummary;
        const taskData = Object.keys(taskSummary).map(t => ({
            '업무': t, '총 시간': formatDuration(taskSummary[t].duration), '총 인건비(원)': Math.round(taskSummary[t].cost), '총 처리량(개)': taskSummary[t].quantity,
            '분당 처리량': taskSummary[t].avgThroughput.toFixed(2), '개당 처리비용(원)': Math.round(taskSummary[t].avgCostPerItem), '평균 투입인원': (taskSummary[t].avgDailyStaff || 0).toFixed(1),
            '총 인원(명)': taskSummary[t].avgStaff, '인당 효율': taskSummary[t].efficiency.toFixed(2)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);

        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        const kpis = tMetrics.kpis;
        const kpiData = [
            { '항목': '총 업무 시간', '값': formatDuration(kpis.totalDuration) }, { '항목': '총 인건비', '값': `${Math.round(kpis.totalCost).toLocaleString()} 원` }, { '항목': '총 처리량', '값': `${kpis.totalQuantity.toLocaleString()} 개` },
            { '항목': '분당 처리량', '값': `${kpis.overallAvgThroughput.toFixed(2)} 개/분` }, { '항목': '개당 처리비용', '값': `${kpis.overallAvgCostPerItem.toFixed(0)} 원/개` }, { '항목': '평균 근무 인원', '값': `${Number(kpis.activeMembersCount).toFixed(1)} 명` },
            { '항목': '비업무 시간', '값': formatDuration(kpis.nonWorkMinutes) }, { '항목': 'COQ(품질비용) 비율', '값': `${kpis.coqPercentage.toFixed(1)} %` }
        ];
        const wsKPI = XLSX.utils.json_to_sheet(kpiData);
        fitToColumn(wsKPI);
        XLSX.utils.book_append_sheet(workbook, wsKPI, '주요 지표(KPI)');

        const partSummary = tMetrics.aggr.partSummary;
        const partData = Object.keys(partSummary).map(part => ({
            '파트': part, '총 업무시간': formatDuration(partSummary[part].duration), '총 인건비(원)': Math.round(partSummary[part].cost), '참여 인원(명)': partSummary[part].members.size
        }));
        const wsPart = XLSX.utils.json_to_sheet(partData);
        fitToColumn(wsPart);
        XLSX.utils.book_append_sheet(workbook, wsPart, '파트별 요약');

        const memberSummary = tMetrics.aggr.memberSummary;
        const memberData = Object.keys(memberSummary).map(m => ({
            '이름': m, '파트': tData.memberToPartMap.get(m) || '알바', '총 업무시간': formatDuration(memberSummary[m].duration), '총 인건비(원)': Math.round(memberSummary[m].cost), '수행 업무 수': memberSummary[m].tasks.size
        }));
        const wsMember = XLSX.utils.json_to_sheet(memberData);
        fitToColumn(wsMember);
        XLSX.utils.book_append_sheet(workbook, wsMember, '인원별 상세');

        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');
        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('리포트 다운로드 중 오류 발생', true);
    }
};

export const downloadPersonalReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('개인 리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { title, stats, memberName, dateKey } = reportData;

        let logData = [];
        if (stats.dailyLogs.length > 0) {
            logData = stats.dailyLogs.map(log => ({
                '날짜': log.date, '근태 상태': log.attendance, '출근': log.inTime ? formatTimeTo24H(log.inTime) : '-', '퇴근': log.outTime ? formatTimeTo24H(log.outTime) : '-',
                '주요 업무': log.mainTask, '총 근무 시간': formatDuration(log.workTime)
            }));
        } else { logData = [{'결과': '기록 없음'}]; }
        const wsLog = XLSX.utils.json_to_sheet(logData);
        fitToColumn(wsLog);

        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        const summaryData = [
            { '항목': '이름', '값': memberName }, { '항목': '기간/날짜', '값': dateKey }, { '항목': '총 근무일', '값': `${stats.workDaysCount}일` },
            { '항목': '총 업무 시간', '값': formatDuration(stats.totalWorkMinutes) }, { '항목': '예상 급여(세전)', '값': `${Math.round(stats.totalWageCost).toLocaleString()} 원` },
            { '항목': '근태 특이사항', '값': Object.entries(stats.attendanceCounts).filter(([,c])=>c>0).map(([t,c])=>`${t} ${c}회`).join(', ') || '없음' }
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        fitToColumn(wsSummary);
        XLSX.utils.book_append_sheet(workbook, wsSummary, '개인 요약');

        const taskData = Object.entries(stats.taskStats).map(([task, data]) => ({
            '업무명': task, '수행 횟수': data.count, '총 소요 시간': formatDuration(data.duration),
            '비중(%)': (stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes * 100).toFixed(1) : 0), '평균 시간/건': formatDuration(data.count > 0 ? data.duration / data.count : 0)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);
        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 통계');

        XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');

        if (stats.attendanceLogs.length > 0) {
            const attData = stats.attendanceLogs.map(log => ({ '날짜': log.date, '유형': log.type, '상세 내용': log.detail }));
            const wsAtt = XLSX.utils.json_to_sheet(attData);
            fitToColumn(wsAtt);
            XLSX.utils.book_append_sheet(workbook, wsAtt, '근태 상세 기록');
        }

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('개인 리포트 다운로드 중 오류 발생', true);
    }
};