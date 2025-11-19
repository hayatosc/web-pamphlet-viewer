<script lang="ts">
  /**
   * Canvas表示コンポーネント
   */
  let {
    canvasElement = $bindable(),
    containerElement = $bindable()
  }: {
    canvasElement?: HTMLCanvasElement | null;
    containerElement?: HTMLDivElement | null;
  } = $props();
</script>

<div
  bind:this={containerElement}
  class="flex-1 relative overflow-hidden"
  style="touch-action: none; -webkit-user-select: none; user-select: none;"
>
  <div class="absolute inset-0 flex items-center justify-center p-4">
    <canvas
      bind:this={canvasElement}
      class="shadow-lg"
      style="max-width: 100%; max-height: 100%;"
    ></canvas>
  </div>
</div>
