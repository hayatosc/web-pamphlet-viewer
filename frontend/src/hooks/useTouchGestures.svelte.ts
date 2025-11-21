import { TouchHandler } from '../lib/touch-handler';
import type { CanvasRenderer } from '../lib/canvas-renderer';

/**
 * タッチジェスチャーを管理するhook
 */
export function useTouchGestures(
  containerElement: HTMLDivElement | null,
  renderer: CanvasRenderer | null,
  onNextPage: () => void,
  onPrevPage: () => void
) {
  let touchHandler = $state<TouchHandler | null>(null);

  /**
   * パン処理（等倍時は無効、ズーム時のみ有効）
   */
  function handlePan(deltaX: number, deltaY: number): void {
    if (!renderer) return;

    // 等倍時はパン無効（スワイプのみ）
    const currentScale = renderer.getScale();
    if (currentScale <= 1) return;

    renderer.pan(deltaX, deltaY);
  }

  /**
   * ダブルタップ処理（リセット）
   */
  function handleDoubleTap(): void {
    if (!renderer) return;

    renderer.resetTransform();
  }

  /**
   * 初期化
   */
  function initialize() {
    if (!containerElement) return;

    touchHandler = new TouchHandler(containerElement, {
      onPan: handlePan,
      onSwipeLeft: onNextPage,
      onSwipeRight: onPrevPage,
      onDoubleTap: handleDoubleTap
    });
  }

  /**
   * クリーンアップ
   */
  function cleanup() {
    touchHandler?.destroy();
  }

  return {
    initialize,
    cleanup
  };
}
