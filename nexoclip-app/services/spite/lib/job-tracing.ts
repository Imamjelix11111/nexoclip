export function resolveDurableJobId(data: Record<string, unknown>): string | null {
  const value = (data as any).generationId || (data as any).lastGenerationId
  return typeof value === 'string' && value ? value : null
}

export function shortJobId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
