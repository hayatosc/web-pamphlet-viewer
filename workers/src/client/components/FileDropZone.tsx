import type { FileWithPreview } from '../types';

interface FileDropZoneProps {
  isDragging: boolean;
  isProcessing: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onFileInput: (e: Event) => void;
}

export function FileDropZone({
  isDragging,
  isProcessing,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
}: FileDropZoneProps) {
  return (
    <div
      class={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <svg
        class="mx-auto h-12 w-12 text-gray-400"
        stroke="currentColor"
        fill="none"
        viewBox="0 0 48 48"
        aria-hidden="true"
      >
        <path
          d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <p class="mt-2 text-sm text-gray-600">
        画像ファイルをドラッグ&ドロップ
        <br />
        または
      </p>
      <label class="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 cursor-pointer">
        ファイルを選択
        <input
          type="file"
          class="hidden"
          multiple
          accept="image/*"
          onChange={onFileInput}
          disabled={isProcessing}
        />
      </label>
    </div>
  );
}
