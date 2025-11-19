import { TouchHandler } from '../lib/touch-handler';
import type { CanvasRenderer } from '../lib/canvas-renderer';

/**
 * タッチジェスチャーを管理するhook
 */
export function useTouchGestures(
  containerElement: HTMLDivElement | null,
  renderer: CanvasRenderer | null,
  onNextPage: () => void,
  onPrevPage: () => void,
  onRedraw: () => Promise<void>
) {
  let touchHandler = $state<TouchHandler | null>(null);

  /**
   * ズーム処理
   */
  async function handleZoom(scale: number): Promise<void> {
    if (!renderer) return;

    renderer.setScale(scale);
    touchHandler?.setScale(scale);

    await onRedraw();
  }

  /**
   * パン処理
   */
  async function handlePan(deltaX: number, deltaY: number): Promise<void> {
    if (!renderer) return;

    renderer.pan(deltaX, deltaY);

    await onRedraw();
  }

  /**
   * ダブルタップ処理（ズームリセット）
   */
  async function handleDoubleTap(): Promise<void> {
    if (!renderer) return;

    renderer.resetTransform();
    touchHandler?.setScale(1);

    await onRedraw();
  }

  /**
   * 初期化
   */
  function initialize() {
    if (!containerElement) return;

    touchHandler = new TouchHandler(containerElement, {
      onZoom: handleZoom,
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
