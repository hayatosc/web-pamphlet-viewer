interface UploadProgressProps {
  progress: number;
}

export function UploadProgress({ progress }: UploadProgressProps) {
  if (progress === 0 || progress >= 100) return null;

  return (
    <div class="mt-4">
      <div class="flex justify-between mb-1">
        <span class="text-sm font-medium text-gray-700">アップロード中</span>
        <span class="text-sm font-medium text-gray-700">{progress}%</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div
          class="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
}
