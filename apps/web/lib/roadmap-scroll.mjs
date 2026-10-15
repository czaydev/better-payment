// Vertical scroll per pixel of horizontal travel while the route is pinned.
export const ROADMAP_PACE = 0.8;

/** @param {{ reducedMotion: boolean, viewportHeight: number, stageHeight: number, stickyTop: number, travel: number }} geometry */
export function canLinkRoadmapScroll({ reducedMotion, viewportHeight, stageHeight, stickyTop, travel }) {
  return !reducedMotion && travel > 0 && viewportHeight >= stageHeight + stickyTop + 16;
}

/** @param {number} rootTop @param {number} stickyTop @param {number} travel */
export function roadmapProgress(rootTop, stickyTop, travel) {
  return travel > 0 ? Math.max(0, Math.min(1, (stickyTop - rootTop) / (travel * ROADMAP_PACE))) : 1;
}

/** @param {number} current @param {number} start @param {number} travel @param {number} step */
export function roadmapScrollTarget(current, start, travel, step) {
  return Math.max(start, Math.min(start + travel * ROADMAP_PACE, current + step * ROADMAP_PACE));
}
