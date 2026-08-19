const KIND_TITLES = {
  image: 'Image generation',
  video: 'Video generation',
  clipping: 'AI clipping',
  audio: 'Audio generation',
  workflow_node: 'Workflow node',
  vimax_render_video: 'Storyboard render',
  vimax_narrative_planning: 'Storyboard planning',
  vimax_novel_planning: 'Storyboard planning',
};

export function toJobListItem(job) {
  const r = job.result && typeof job.result === 'object' ? job.result : null;
  return {
    id: job.id,
    kind: job.kind,
    title: (r && r.title) || KIND_TITLES[job.kind] || 'Job',
    status: job.status,
    outputUrl: (r && r.outputUrl) || null,
    thumbnailUrl: (r && r.thumbnailUrl) || null,
  };
}
