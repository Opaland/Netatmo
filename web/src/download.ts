// #258: the one « Blob → link → download » of the app (exports, backup, journals).
/** Offer `blob` as a download named `name`; the object URL is released afterwards. */
export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
