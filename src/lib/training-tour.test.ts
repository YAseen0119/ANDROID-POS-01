/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAINING_TOUR_STEPS,
  createInitialTourProgress,
  clampTourStepIndex,
  markTourStepVisited,
  markTourCompleted,
  calculateTourCompletionPercent,
  getTourStepsForRole,
} from './training-tour';

test('TRAINING_TOUR_STEPS covers all 13 POS modules with bilingual Arabic and English content', () => {
  assert.equal(TRAINING_TOUR_STEPS.length, 13);
  for (const step of TRAINING_TOUR_STEPS) {
    assert.ok(step.titleAr.length > 0);
    assert.ok(step.titleEn.length > 0);
    assert.ok(step.descriptionAr.length > 0);
    assert.ok(step.keyPointsAr.length >= 3);
    assert.ok(step.practicalTipAr.length > 0);
  }
});

test('clampTourStepIndex safely bounds step indices', () => {
  assert.equal(clampTourStepIndex(-5, 13), 0);
  assert.equal(clampTourStepIndex(0, 13), 0);
  assert.equal(clampTourStepIndex(3, 13), 3);
  assert.equal(clampTourStepIndex(99, 13), 12);
  assert.equal(clampTourStepIndex(NaN, 13), 0);
});

test('markTourStepVisited and calculateTourCompletionPercent track step progress accurately', () => {
  let state = createInitialTourProgress();
  assert.equal(calculateTourCompletionPercent(state), 0);

  state = markTourStepVisited(state, 0);
  assert.equal(state.lastStepIndex, 0);
  assert.equal(state.completedStepIds.length, 1);
  assert.equal(calculateTourCompletionPercent(state), 8);

  state = markTourStepVisited(state, 1);
  assert.equal(state.lastStepIndex, 1);
  assert.equal(state.completedStepIds.length, 2);
  assert.equal(calculateTourCompletionPercent(state), 15);

  // Visiting same step again does not duplicate IDs
  state = markTourStepVisited(state, 1);
  assert.equal(state.completedStepIds.length, 2);
});

test('markTourCompleted marks all steps complete and reaches 100%', () => {
  const initial = createInitialTourProgress();
  const completed = markTourCompleted(initial);
  assert.equal(completed.completed, true);
  assert.equal(completed.isCompleted, true);
  assert.equal(completed.completedStepIds.length, TRAINING_TOUR_STEPS.length);
  assert.equal(calculateTourCompletionPercent(completed), 100);
});

test('getTourStepsForRole filters relevant steps for cashier or inventory_clerk while returning all for admin/manager', () => {
  assert.equal(getTourStepsForRole('admin').length, 13);
  assert.equal(getTourStepsForRole('manager').length, 13);

  const cashierSteps = getTourStepsForRole('cashier');
  assert.ok(cashierSteps.some((s) => s.tab === 'checkout'));
  assert.ok(cashierSteps.some((s) => s.tab === 'customers'));
  assert.ok(cashierSteps.some((s) => s.tab === 'sales'));

  const clerkSteps = getTourStepsForRole('inventory_clerk');
  assert.ok(clerkSteps.some((s) => s.tab === 'products'));
  assert.ok(clerkSteps.some((s) => s.tab === 'inventory'));
});
