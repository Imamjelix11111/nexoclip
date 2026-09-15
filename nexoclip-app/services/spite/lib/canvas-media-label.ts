export function uploadedMediaLabel(filename: string): string {
  const trimmed = (filename ?? '').trim()
  return trimmed || 'Upload'
}

export function folderMediaLabel(folderName: string): string {
  return (folderName ?? '').trim()
}
