// Сохранение и открытие файлов в браузере.

/** В изолированной среде предпросмотра скачивание файлов и печать недоступны */
export const SANDBOX = import.meta.env.VITE_SANDBOX === '1';

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(name: string, data: unknown): void {
  downloadBlob(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

/** Открыть диалог выбора файла и прочитать JSON; null — файл не выбран или не читается */
export function pickJson(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export function pickImage(maxBytes = 400_000): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file || file.size > maxBytes) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'расчёт';
}
