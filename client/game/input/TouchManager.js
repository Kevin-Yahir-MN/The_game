export class TouchManager {
    constructor(canvas, historyManager) {
        this.canvas = canvas;
        this.historyManager = historyManager;
    }

    handleTouchAsClick(e) {
        e.preventDefault();
        if (e.touches && e.touches.length > 0) {
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            if (this.historyManager.gameState.historyIconAreas) {
                for (const area of this.historyManager.gameState.historyIconAreas) {
                    if (x >= area.x && x <= area.x + area.width &&
                        y >= area.y && y <= area.y + area.height) {
                        this.historyManager.showColumnHistory(area.column);
                        return;
                    }
                }
            }
        }
    }
}