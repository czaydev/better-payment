import assert from 'node:assert/strict';
import test from 'node:test';
import { canLinkRoadmapScroll, roadmapProgress, roadmapScrollTarget } from '../lib/roadmap-scroll.mjs';

const geometry = { reducedMotion: false, viewportHeight: 667, stageHeight: 422, stickyTop: 123.5, travel: 4500 };

test('a phone-sized viewport can pin the roadmap without a width restriction', () => {
  assert.equal(canLinkRoadmapScroll(geometry), true);
});
test('desktop geometry retains scroll-linked navigation', () => {
  assert.equal(canLinkRoadmapScroll({ ...geometry, viewportHeight: 800, stageHeight: 350, stickyTop: 190 }), true);
});
test('reduced motion, short screens and non-overflowing tracks use native scrolling', () => {
  assert.equal(canLinkRoadmapScroll({ ...geometry, reducedMotion: true }), false);
  assert.equal(canLinkRoadmapScroll({ ...geometry, viewportHeight: 390 }), false);
  assert.equal(canLinkRoadmapScroll({ ...geometry, travel: 0 }), false);
});
test('the stage must fit with its sticky offset and bottom breathing room', () => {
  assert.equal(canLinkRoadmapScroll({ ...geometry, viewportHeight: 561.5 }), true);
  assert.equal(canLinkRoadmapScroll({ ...geometry, viewportHeight: 561 }), false);
});
test('page scroll advances the route monotonically and clamps both ends', () => {
  assert.equal(roadmapProgress(300, 80, 1000), 0);
  assert.equal(roadmapProgress(80, 80, 1000), 0);
  assert.equal(roadmapProgress(-320, 80, 1000), 0.5);
  assert.equal(roadmapProgress(-720, 80, 1000), 1);
  assert.equal(roadmapProgress(-900, 80, 1000), 1);
  assert.equal(roadmapProgress(0, 80, 0), 1);
});
test('previous and next stay inside the pinned journey', () => {
  assert.equal(roadmapScrollTarget(1100, 1000, 1000, 200), 1260);
  assert.equal(roadmapScrollTarget(1100, 1000, 1000, -200), 1000);
  assert.equal(roadmapScrollTarget(1790, 1000, 1000, 200), 1800);
  assert.equal(roadmapScrollTarget(1800, 1000, 1000, 200), 1800);
});
