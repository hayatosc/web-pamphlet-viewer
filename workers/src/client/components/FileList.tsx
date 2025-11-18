import type { FileWithPreview } from '../types';

interface FileListProps {
  files: FileWithPreview[];
}

export function FileList({ files }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <div class="mt-6">
      <h2 class="text-lg font-medium text-gray-900 mb-4">
        選択されたファイル ({files.length}枚)
      </h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {files.map((file, index) => (
          <div key={index} class="relative group">
            <img
              src={file.preview}
              alt={file.name}
              class="w-full h-32 object-cover rounded-lg"
            />
            <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-2 rounded-b-lg truncate">
              {file.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
