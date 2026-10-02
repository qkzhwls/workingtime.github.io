// === js/app-history-logic.js ===
// 설명: 이력 보기 로직의 진입점 (Index). 기능별로 분리된 모듈들을 통합하여 내보냅니다.
// (기존의 거대했던 app-history-logic.js를 대체합니다)

// 1. 데이터 보정 (Enricher)
export { augmentHistoryWithPersistentLeave } from './history-enricher.js?v=202610021042';

// 2. 리스트 제어 및 네비게이션 (Controller)
export {
    loadAndRenderHistoryList,
    renderHistoryDateListByMode,
    switchHistoryView,
    updateGranularityButtons,
    openHistoryQuantityModal,
    requestHistoryDeletion
} from './history-list-controller.js?v=202610021042';

// 3. 일별 상세 렌더링 (Daily Renderer)
export { renderHistoryDetail } from './history-daily-renderer.js?v=202610021042';

// 4. 기록 관리 테이블 (Record Table)
export {
    openHistoryRecordManager,
    renderHistoryRecordsTable
} from './history-record-table.js?v=202610021042';