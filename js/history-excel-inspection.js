// === js/history-excel-inspection.js ===
import { db, allHistoryData } from './state.js'; 
import { showToast, getTodayDateString } from './utils.js';
import { fitToColumn } from './history-excel-utils.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; 

const downloadListInspectionHistory = (format = 'xlsx') => {
    showToast('입고 리스트 데이터를 준비 중입니다...');
    const allLists = [];
    allHistoryData.forEach(day => {
        if (day.inspectionList && day.inspectionList.length > 0) {
            day.inspectionList.forEach(item => { allLists.push({ date: day.id, ...item }); });
        }
    });

    if (allLists.length === 0) return showToast('다운로드할 입고 리스트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const headers = ['날짜', '코드', '상품명', '옵션', '공급처', '수량', '기준 두께', '상태'];
        allLists.sort((a, b) => b.date.localeCompare(a.date));
        const sheetData = allLists.map(item => ({
            '날짜': item.date, '코드': item.code || '-', '상품명': item.name, '옵션': item.option || '-',
            '공급처': item.supplierName || '-', '수량': item.qty || 0, '기준 두께': item.thickness || '-', '상태': item.status || '대기'
        }));
        const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headers });
        fitToColumn(worksheet);
        XLSX.utils.book_append_sheet(workbook, worksheet, '입고_리스트_내역');
        XLSX.writeFile(workbook, `입고리스트_이력_${getTodayDateString()}.${format}`);
        showToast('입고 리스트 다운로드 완료');
    } catch (e) {
        console.error("Export list inspection history failed:", e);
        showToast('파일 생성 실패', true);
    }
};

const downloadProductInspectionHistory = async (format = 'xlsx') => {
    showToast('검수 이력(상품별) 데이터를 불러오는 중...');
    let inspectionData = [];
    try {
        const colRef = collection(db, 'product_history');
        const snapshot = await getDocs(colRef);
        snapshot.forEach(doc => { inspectionData.push({ id: doc.id, ...doc.data() }); });
    } catch (e) {
        console.error("Error fetching inspection history:", e);
        return showToast('데이터 불러오기 실패', true);
    }
    
    if (!inspectionData || inspectionData.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);
    
    try {
        const workbook = XLSX.utils.book_new();
        const sheet1Headers = ['상품명', '코드', '옵션', '공급처 상품명', '총 입고 횟수', '최근 검수일', '최근 불량 요약'];
        const sheet1Data = inspectionData.map(item => ({
            '상품명': item.id, '코드': item.lastCode || '-', '옵션': item.lastOption || '-', '공급처 상품명': item.lastSupplierName || '-',
            '총 입고 횟수': item.totalInbound || 0, '최근 검수일': item.lastInspectionDate || '-', '최근 불량 요약': (item.defectSummary && item.defectSummary.length > 0) ? item.defectSummary[item.defectSummary.length - 1] : '-'
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상품별_요약`);

        if (format === 'csv') {
             XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.csv`); return;
        }

        const sheet2Headers = ['상품명', '공급처 상품명', '일시(날짜)', '일시(시간)', '담당', '입고일자/패킹No', '코드', '옵션', '수량', '상태', '특이사항', '두께(실측)', '원단 상태', '컬러', '뒤틀림', '올 풀림', '실밥 마감', '지퍼', '단추', '안감', '보풀', '이염'];
        const allLogs = inspectionData.flatMap(item => {
            const logs = item.logs || [];
            return logs.map(log => ({
                '상품명': item.id, '공급처 상품명': log.supplierName || item.lastSupplierName || '-', '일시(날짜)': log.date || '-', '일시(시간)': log.time || '-', '담당': log.inspector || '-', '입고일자/패킹No': log.inboundDate || log.packingNo || '-', '코드': log.code || '-', '옵션': log.option || '-', '수량': log.inboundQty || 0, '상태': log.status || '-', '특이사항': (log.defects?.length > 0 ? `[${log.defects.join(', ')}] ` : '') + (log.note || ''),
                '두께(실측)': log.checklist?.thickness || '-', '원단 상태': log.checklist?.fabric || '-', '컬러': log.checklist?.color || '-', '뒤틀림': log.checklist?.distortion || '-', '올 풀림': log.checklist?.unraveling || '-', '실밥 마감': log.checklist?.finishing || '-', '지퍼': log.checklist?.zipper || '-', '단추': log.checklist?.button || '-', '안감': log.checklist?.lining || '-', '보풀': log.checklist?.pilling || '-', '이염': log.checklist?.dye || '-'
            }));
        }).sort((a, b) => b['일시(날짜)'].localeCompare(a['일시(날짜)']));

        const worksheet2 = XLSX.utils.json_to_sheet(allLogs, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `상세_로그`);
        XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.${format}`);
        showToast('검수 이력(상품별) 다운로드 완료');
    } catch (error) {
        console.error('Export inspection history failed:', error);
        showToast('파일 생성 실패', true);
    }
};

export const downloadInspectionHistory = async (format = 'xlsx', viewMode = 'product') => {
    if (viewMode === 'list') { downloadListInspectionHistory(format); } 
    else { await downloadProductInspectionHistory(format); }
};

export const downloadPeriodInspectionAsExcel = (startDate, endDate, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    const allLists = [];
    allHistoryData.filter(d => d.id >= startDate && d.id <= endDate).forEach(day => {
        if (day.inspectionList && day.inspectionList.length > 0) {
            day.inspectionList.forEach(item => { allLists.push({ date: day.id, ...item }); });
        }
    });

    if (allLists.length === 0) return showToast('선택한 기간에 검수 리스트 데이터가 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const headers = ['날짜', '코드', '상품명', '옵션', '공급처', '수량', '기준 두께', '상태'];
    allLists.sort((a, b) => b.date.localeCompare(a.date));
    const sheetData = allLists.map(item => ({
        '날짜': item.date, '코드': item.code || '-', '상품명': item.name, '옵션': item.option || '-', '공급처': item.supplierName || '-', '수량': item.qty || 0, '기준 두께': item.thickness || '-', '상태': item.status || '대기'
    }));

    const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headers });
    fitToColumn(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, '입고_리스트_내역');
    XLSX.writeFile(workbook, `검수이력_리스트_기간_${startDate}_${endDate}.${format}`);
    showToast('기간별 검수이력 다운로드 완료');
};