// === js/history-excel-attendance.js ===
import { allHistoryData, LEAVE_TYPES } from './state.js?v=202610021042';

// 엑셀 근태 요약의 열 순서. LEAVE_TYPES에 있는데 여기 없는 종류는 뒤에 자동으로 붙는다
// → 근태 종류가 추가돼도 엑셀에서 누락되지 않는다.
const ATT_COL_BASE = ['지각', '외출', '조퇴', '결근', '연차', '출장', '매장근무', '재택근무', '기타', '외근'];
const ATT_COLS = [...ATT_COL_BASE, ...LEAVE_TYPES.filter(t => !ATT_COL_BASE.includes(t))];
// 데이터에 실제로 존재하는 종류만 뒤에 덧붙인다(예: 예전 '휴직' 기록).
// 쓰지 않는 옛 종류로 빈 열이 생기지 않으면서, 남아 있는 기록도 숨겨지지 않는다.
const attColsFor = (types) => [...ATT_COLS, ...[...new Set(types)].filter(t => t && !ATT_COLS.includes(t))];

// XLSX.json_to_sheet 는 첫 행의 키로 헤더를 만든다.
// 뒤쪽 행에서만 등장한 종류(예전 '휴직' 등)가 빠지지 않도록 모든 행의 열을 맞춰준다.
const normalizeAttRows = (rows) => {
    const typeKeys = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => {
        if (k !== '이름' && !k.startsWith('총 ')) typeKeys.add(k);
    }));
    const cols = attColsFor(typeKeys);
    return rows.map(r => {
        const out = { '이름': r['이름'] };
        cols.forEach(t => { out[t] = r[t] || 0; });
        out['총 횟수'] = r['총 횟수'] || 0;
        out['총 결근일수'] = r['총 결근일수'] || 0;
        out['총 연차일수'] = r['총 연차일수'] || 0;
        return out;
    });
};
const newAttRow = (member) => {
    const row = { '이름': member };
    ATT_COLS.forEach(t => { row[t] = 0; });
    row['총 횟수'] = 0; row['총 결근일수'] = 0; row['총 연차일수'] = 0;
    return row;
};
import { formatTimeTo24H, getWeekOfYear, showToast, getTodayDateString } from './utils.js?v=202610021042';
import { fitToColumn } from './history-excel-utils.js?v=202610021042';

export const downloadPeriodAttendanceAsExcel = (startDate, endDate, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    const dataList = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
    if (dataList.length === 0) return showToast('선택한 기간에 근태 데이터가 없습니다.', true);

    const summary = {};
    dataList.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!summary[entry.member]) {
                summary[entry.member] = newAttRow(entry.member);
            }
            const rec = summary[entry.member];
            if (entry.type) rec[entry.type] = (rec[entry.type] || 0) + 1;
            if (entry.type !== '연차') rec['총 횟수']++;
            // 일수는 '그 날 하루'만 더한다(날짜별로 이미 펼쳐져 있음).
            if (entry.type === '결근') rec['총 결근일수'] += 1;
            if (entry.type === '연차') rec['총 연차일수'] += 1;
        });
    });

    const sheetData = normalizeAttRows(Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름'])));
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
                    summary[entry.member] = newAttRow(entry.member);
                }
                const rec = summary[entry.member];
                if (entry.type) rec[entry.type] = (rec[entry.type] || 0) + 1;
                if (entry.type !== '연차') rec['총 횟수']++;
                // 일수는 '그 날 하루'만 더한다. onLeaveMembers는 이미 날짜별로 펼쳐져 있어서
                // 여기서 다시 전체 기간을 더하면 2일짜리 연차가 4일로 부풀었다.
                if (entry.type === '결근') rec['총 결근일수'] += 1;
                if (entry.type === '연차') rec['총 연차일수'] += 1;
            });
        });

        const sheetData = normalizeAttRows(Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름'])));
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
        XLSX.writeFile(workbook, `${year}년_연차관리대장_${getTodayDateString()}.xlsx`);
        showToast('연차관리대장 엑셀 다운로드 완료');
    } catch (e) {
        console.error("Excel download error:", e);
        showToast("엑셀 다운로드 중 오류가 발생했습니다.", true);
    }
};