import { LearningStore } from './store.js';

export interface LearningDiagnostics {
  reviewsByStatus: Record<string, number>;
  actionsByStatus: Record<string, number>;
  actionsByType: Record<string, number>;
  artifactCount: number;
  skillSnapshotCount: number;
}

export function getLearningDiagnostics(store: LearningStore): LearningDiagnostics {
  const reviews = store.listReviews({ limit: 10_000 });
  const actions = store.listActions({ limit: 10_000 });
  return {
    reviewsByStatus: countBy(reviews.map((review) => review.status)),
    actionsByStatus: countBy(actions.map((action) => action.status)),
    actionsByType: countBy(actions.map((action) => action.actionType)),
    artifactCount: store.listArtifacts({ limit: 10_000 }).length,
    skillSnapshotCount: store.listSkillSnapshots({ limit: 10_000 }).length,
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
