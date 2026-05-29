// === js/history-excel-attendance.js ===
import { allHistoryData } from './state.js';
import { calculateDateDifference, formatTimeTo24H, getWeekOfYear, showToast } from './utils.js';
import { fitToColumn } from './history-excel-utils.js';

export const downloadPeriodAttendanceAsExcel = (startDate, endDate, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    const dataList = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
    if (dataList.length === 0) return showToast('선택한 기간에 근태 데이터가 없습니다.', true);

    const summary = {};
    dataList.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!summary[entry.member]) {
                summary[entry.member] = { '이름': entry.member, '지각':0, '외출':0, '조퇴':0, '결근':0, '연차':0, '출장':0, '총 횟수':0, '총 결근일수':0, '총 연차일수':0 };
            }
            const rec = summary[entry.member];
            if (rec.hasOwnProperty(entry.type)) rec[entry.type]++;
            if (entry.type !== '연차') rec['총 횟수']++;
            if (entry.type === '결근') rec['총 결근일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            if (entry.type === '연차') rec['총 연차일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        });
    });

    const sheetData = Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름']));
    if (sheetData.length === 0) return showToast('해당 기간에 근태 기록이 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    fitToColumn(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, '기간 근태 요약');
    XLSX.writeFile(workbook, `근태기록_기간_${startDate}_${endDate}.${format}`);
    showToast('기간별 근태기록 다운로드 완료');
};

export const downloadAttendanceExcel = (viewMode, key, format = 'xlsx') => {
    let dataList = [];
    let fileName = '';
    
    if (viewMode === 'daily') {
        const day = allHistoryData.find(d => d.id === key);
        if (day) dataList = [day];
        fileName = `근태기록_일별_${key}.${format}`;
    } else if (viewMode === 'weekly') {
        dataList = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === key);
        fileName = `근태기록_주별_${key}.${format}`;
    } else if (viewMode === 'monthly') {
        dataList = allHistoryData.filter(d => d.id.startsWith(key));
        fileName = `근태기록_월별_${key}.${format}`;
    }

    if (dataList.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

    const workbook = XLSX.utils.book_new();

    if (viewMode === 'daily') {
        const dayData = dataList[0];
        const leaves = dayData.onLeaveMembers || [];
        if (leaves.length === 0) return showToast('근태 기록이 없습니다.', true);

        const sheetData = leaves.map(entry => {
            const isTimeBased = (entry.type === '외출' || entry.type === '조퇴' || entry.type === '지각');
            return {
                '이름': entry.member, '유형': entry.type,
                '시작 시간/날짜': isTimeBased ? formatTimeTo24H(entry.startTime) : entry.startDate,
                '종료 시간/날짜': isTimeBased ? formatTimeTo24H(entry.endTime) : (entry.endDate || entry.startDate || '-')
            };
        }).sort((a, b) => a['이름'].localeCompare(b['이름']));

        const worksheet = XLSX.utils.json_to_sheet(sheetData);
        fitToColumn(worksheet);
        XLSX.utils.book_append_sheet(workbook, worksheet, `일별 근태`);
        
    } else {
        const summary = {};
        dataList.forEach(day => {
            (day.onLeaveMembers || []).forEach(entry => {
                if (!summary[entry.member]) {
                    summary[entry.member] = { '이름': entry.member, '지각':0, '외출':0, '조퇴':0, '결근':0, '연차':0, '출장':0, '총 횟수':0, '총 결근일수':0, '총 연차일수':0 };
                }
                const rec = summary[entry.member];
                if (rec.hasOwnProperty(entry.type)) rec[entry.type]++;
                if (entry.type !== '연차') rec['총 횟수']++;
                if (entry.type === '결근') rec['총 결근일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
                if (entry.type === '연차') rec['총 연차일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            });
        });

        const sheetData = Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름']));
        if (sheetData.length === 0) return showToast('근태 기록이 없습니다.', true);

        const worksheet = XLSX.utils.json_to_sheet(sheetData);
        fitToColumn(worksheet);
        XLSX.utils.book_append_sheet(workbook, worksheet, '근태 요약');
    }
    XLSX.writeFile(workbook, fileName);
};

export const downloadLeaveLedgerExcel = (year, data) => {
    try {
        const headers = ["이름", "총 연차", "기간 (리셋~만료)", "사용 개수", "잔여 연차", "사용 내역"];
        const rows = data.map(row => [ row.member, row.total, row.periodText, row.used, row.remaining, row.history ]);

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `${year}년 연차관리대장`);

        worksheet['!cols'] = [ { wch: 10 }, { wch: 10 }, { wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 60 } ];
        XLSX.writeFile(workbook, `${year}년_연차관리대장_${new Date().toISOString().slice(0,10)}.xlsx`);
        showToast('연차관리대장 엑셀 다운로드 완료');
    } catch (e) {
        console.error("Excel download error:", e);
        showToast("엑셀 다운로드 중 오류가 발생했습니다.", true);
    }
};