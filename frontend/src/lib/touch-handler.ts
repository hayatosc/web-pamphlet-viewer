/**
 * タッチイベント管理
 */

export interface TouchState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface TouchHandlerCallbacks {
  onZoom?: (scale: number) => void;
  onPan?: (deltaX: number, deltaY: number) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onDoubleTap?: () => void;
}

export class TouchHandler {
  private element: HTMLElement;
  private callbacks: TouchHandlerCallbacks;

  // ピンチズーム用
  private initialDistance = 0;
  private currentScale = 1;
  private minScale = 0.5;
  private maxScale = 5;

  // パン用
  private isPanning = false;
  private lastTouchX = 0;
  private lastTouchY = 0;

  // スワイプ用
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeThreshold = 50; // px
  private swipeMaxVertical = 100; // 縦方向の許容範囲

  // ダブルタップ用
  private lastTapTime = 0;
  private doubleTapDelay = 300; // ms

  // バインドされたイベントハンドラ（メモリリーク防止）
  private boundHandleTouchStart: (e: TouchEvent) => void;
  private boundHandleTouchMove: (e: TouchEvent) => void;
  private boundHandleTouchEnd: (e: TouchEvent) => void;
  private boundHandleContextMenu: (e: Event) => void;

  constructor(element: HTMLElement, callbacks: TouchHandlerCallbacks) {
    this.element = element;
    this.callbacks = callbacks;

    // イベントハンドラをバインド
    this.boundHandleTouchStart = this.handleTouchStart.bind(this);
    this.boundHandleTouchMove = this.handleTouchMove.bind(this);
    this.boundHandleTouchEnd = this.handleTouchEnd.bind(this);
    this.boundHandleContextMenu = (e: Event) => e.preventDefault();

    this.setupListeners();
  }

  private setupListeners(): void {
    // タッチイベント（パッシブリスナーでパフォーマンス向上）
    this.element.addEventListener('touchstart', this.boundHandleTouchStart, { passive: false });
    this.element.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.boundHandleTouchEnd, { passive: true });

    // コンテキストメニュー無効化（長押し時のメニュー）
    this.element.addEventListener('contextmenu', this.boundHandleContextMenu);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2) {
      // ピンチズーム開始
      this.initialDistance = this.getDistance(e.touches[0], e.touches[1]);
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];

      // ダブルタップ検出
      const now = Date.now();
      if (now - this.lastTapTime < this.doubleTapDelay) {
        e.preventDefault(); // ブラウザのデフォルトズームを防止
        this.callbacks.onDoubleTap?.();
        this.lastTapTime = 0; // リセット
      } else {
        this.lastTapTime = now;
      }

      // スワイプ・パン用の初期位置記録
      this.swipeStartX = touch.clientX;
      this.swipeStartY = touch.clientY;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      // ズーム中はパンを有効化
      if (this.currentScale > 1) {
        this.isPanning = true;
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (e.touches.length === 2) {
      // ピンチズーム
      e.preventDefault();
      const currentDistance = this.getDistance(e.touches[0], e.touches[1]);
      const scale = (currentDistance / this.initialDistance) * this.currentScale;

      // スケール制限
      const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, scale));

      this.callbacks.onZoom?.(clampedScale);
    } else if (e.touches.length === 1 && this.isPanning) {
      // パン（ズーム時のみ）
      e.preventDefault();
      const touch = e.touches[0];
      const deltaX = touch.clientX - this.lastTouchX;
      const deltaY = touch.clientY - this.lastTouchY;

      this.callbacks.onPan?.(deltaX, deltaY);

      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (e.touches.length === 0) {
      // すべてのタッチが終了

      // 最終タッチ位置を取得（changedTouches から）
      const finalTouch = e.changedTouches[0];
      const finalX = finalTouch.clientX;
      const finalY = finalTouch.clientY;

      // スワイプ検出（ズーム中でない場合のみ）
      if (!this.isPanning && this.currentScale <= 1) {
        const deltaX = finalX - this.swipeStartX;
        const deltaY = Math.abs(finalY - this.swipeStartY);

        // 横方向のスワイプで、縦方向の移動が少ない場合
        if (deltaY < this.swipeMaxVertical) {
          if (deltaX > this.swipeThreshold) {
            // 右スワイプ（前のページへ）
            this.callbacks.onSwipeRight?.();
          } else if (deltaX < -this.swipeThreshold) {
            // 左スワイプ（次のページへ）
            this.callbacks.onSwipeLeft?.();
          }
        }
      }

      this.isPanning = false;

      // ピンチズーム終了時、現在のスケールを保存
      if (e.changedTouches.length === 1 && this.initialDistance > 0) {
        // 最後のタッチが離れた時点のスケールを保存
        // （onZoomで既に反映されているため、特に処理不要）
      }

      this.initialDistance = 0;
    } else if (e.touches.length === 1) {
      // 2本指から1本指になった（ピンチズーム終了）
      // currentScaleは既にonZoomコールバック内で更新されているため、ここでの処理は不要
      this.initialDistance = 0;

      // 1本指になったので、パン可能状態を更新
      const touch = e.touches[0];
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      if (this.currentScale > 1) {
        this.isPanning = true;
      }
    }
  }

  /**
   * 2点間の距離を計算
   */
  private getDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 現在のスケールを取得（外部から更新）
   */
  private getCurrentScale(): number {
    return this.currentScale;
  }

  /**
   * スケールを設定（外部から呼ばれる）
   */
  setScale(scale: number): void {
    this.currentScale = Math.max(this.minScale, Math.min(this.maxScale, scale));
  }

  /**
   * スケール範囲を設定
   */
  setScaleRange(min: number, max: number): void {
    this.minScale = min;
    this.maxScale = max;
  }

  /**
   * クリーンアップ
   */
  destroy(): void {
    this.element.removeEventListener('touchstart', this.boundHandleTouchStart);
    this.element.removeEventListener('touchmove', this.boundHandleTouchMove);
    this.element.removeEventListener('touchend', this.boundHandleTouchEnd);
    this.element.removeEventListener('contextmenu', this.boundHandleContextMenu);
  }
}
