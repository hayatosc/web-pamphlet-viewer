<script lang="ts">
  /**
   * ローディング表示
   */
  let {
    loading,
    loadingTiles,
    totalTiles,
    error
  }: {
    loading: boolean;
    loadingTiles?: number;
    totalTiles?: number;
    error?: string | null;
  } = $props();

  const showInitialLoading = $derived(loading && (!totalTiles || totalTiles === 0));
  const showTileProgress = $derived(loading && totalTiles != null && totalTiles > 0);
</script>

{#if showInitialLoading}
  <div class="flex items-center justify-center w-full h-full">
    <div class="text-center">
      <div class="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p class="mt-4 text-gray-600">Loading pamphlet...</p>
    </div>
  </div>
{:else if error}
  <div class="flex items-center justify-center w-full h-full">
    <div class="text-center text-red-600">
      <p class="text-lg font-semibold">Error</p>
      <p class="mt-2">{error}</p>
    </div>
  </div>
{:else if showTileProgress}
  <div class="absolute top-4 right-4 bg-white px-4 py-2 rounded-lg shadow-md">
    <p class="text-sm text-gray-600">
      Loading tiles: {loadingTiles} / {totalTiles}
    </p>
  </div>
{/if}
