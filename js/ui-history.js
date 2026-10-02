// === js/ui-history.js ===
// 설명: 이력 보기와 관련된 모든 UI 렌더링 함수를 모아서 내보내는 인덱스 파일입니다.

// 1. 리포트 관련 함수 (일별/주별/월별/연간 리포트)
import {
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
} from './ui-history-reports.js?v=202610021228';

// 2. 근태 이력 관련 함수 (일별/주별/월별 근태)
import {
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderAttendanceYearlyHistory
} from './ui-history-attendance.js?v=202610021228';

// 3. 트렌드 분석 관련 함수 (차트)
import {
    renderTrendAnalysisCharts
} from './ui-history-trends.js?v=202610021228';

// 4. 업무 이력 요약 관련 함수 (주별/월별 요약)
import {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderYearlyHistory
} from './ui-history-summary.js?v=202610021228';

// 5. 개인 리포트 관련 함수
import {
    renderPersonalReport
} from './ui-history-personal.js?v=202610021228';

// 6. 경영 지표 관련 함수
import {
    renderManagementDaily,
    renderManagementSummary
} from './ui-history-management.js?v=202610021228';

// 7. 검수 이력 관련 함수
import {
    renderInspectionHistoryTable,
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history-inspection.js?v=202610021228';

// ✅ [신규] 8. 실적 예측 관련 함수
import {
    renderPredictionTab
} from './ui-history-prediction.js?v=202610021228';


// --- 모든 함수를 ui.js 및 리스너가 사용할 수 있도록 다시 내보내기 ---

export {
    // 리포트
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly,
    
    // 근태 이력
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderAttendanceYearlyHistory,

    // 트렌드 분석
    renderTrendAnalysisCharts,

    // 업무 이력 요약
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderYearlyHistory,

    // 개인 리포트
    renderPersonalReport,

    // 경영 지표
    renderManagementDaily,
    renderManagementSummary,

    // 검수 이력
    renderInspectionHistoryTable,
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode,
    
    // ✅ [신규] 실적 예측
    renderPredictionTab
};