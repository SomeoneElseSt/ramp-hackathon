import type { Metrics } from "@companion/shared";
import { POLL_BASELINE_PER_HOUR } from "./config.js";

// In-memory counters. The whole point: idleModelCalls stays 0 because the
// classifier is only ever reached by a candidate that survived dedup.
const state = {
  eventsObserved: 0,
  candidatesAfterDedup: 0,
  classifyCalls: 0,
  idleModelCalls: 0,
  fired: 0,
  dispatches: 0,
  startedAt: Date.now(),
};

export function recordObserved(count: number): void {
  state.eventsObserved += count;
}

export function recordCandidate(): void {
  state.candidatesAfterDedup += 1;
}

export function recordClassifyCall(): void {
  state.classifyCalls += 1;
}

export function recordFired(): void {
  state.fired += 1;
}

export function recordDispatch(): void {
  state.dispatches += 1;
}

export function snapshot(): Metrics {
  return {
    eventsObserved: state.eventsObserved,
    candidatesAfterDedup: state.candidatesAfterDedup,
    classifyCalls: state.classifyCalls,
    idleModelCalls: state.idleModelCalls,
    fired: state.fired,
    dispatches: state.dispatches,
    startedAt: state.startedAt,
    pollBaselinePerHour: POLL_BASELINE_PER_HOUR,
  };
}
