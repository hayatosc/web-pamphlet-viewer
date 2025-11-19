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
  <div class="absolute inset-0 flex items-center justify-center">
    <canvas
      bind:this={canvasElement}
      class="max-w-full max-h-full shadow-lg"
    ></canvas>
  </div>
</div>
