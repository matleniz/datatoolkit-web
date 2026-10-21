import type { Step, StepTarget } from "../api/types";
import { OP_STAGE } from "../bench/stages";
import type { StepOp } from "./stepOps";

/**
 * Steps-only file (datatoolkit-issues#311): the steps of a pipeline without
 * ids, to re-apply them in another workspace. Fitted state is not carried:
 * imported steps refit on the target workspace's train data.
 */
const STEPS_FILE_FORMAT = "dtk-steps";
const STEPS_FILE_VERSION = 1;
/** Size sanity bounds, checked before anything is dispatched. */
const MAX_STEPS_FILE_BYTES = 1_000_000;
const MAX_STEPS_IN_FILE = 500;

const TARGETS: readonly StepTarget[] = ["train", "test", "both"];

export interface StepsFile {
  format: typeof STEPS_FILE_FORMAT;
  version: typeof STEPS_FILE_VERSION;
  steps: { op: string; target: StepTarget; params: Record<string, unknown>; note?: string }[];
}

/** The file content for `steps` (ids and the front-only `align` flag dropped). */
function buildStepsFile(steps: Step[]): StepsFile {
  return {
    format: STEPS_FILE_FORMAT,
    version: STEPS_FILE_VERSION,
    steps: steps.map((s) => ({
      op: s.op,
      target: s.target,
      params: s.params,
      ...(s.note ? { note: s.note } : {}),
    })),
  };
}

export function serializeStepsFile(steps: Step[]): string {
  return JSON.stringify(buildStepsFile(steps), null, 2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ParsedStepsFile = { steps: Step[] } | { error: string };

/** Validates file text at the boundary; the first problem found is the error. */
export function parseStepsFile(text: string): ParsedStepsFile {
  if (text.length > MAX_STEPS_FILE_BYTES) {
    return { error: `File too large (over ${MAX_STEPS_FILE_BYTES} characters).` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Not a valid JSON file." };
  }
  if (!isRecord(data) || data.format !== STEPS_FILE_FORMAT) {
    return { error: `Not a steps file (format must be "${STEPS_FILE_FORMAT}").` };
  }
  if (data.version !== STEPS_FILE_VERSION) {
    return { error: `Unsupported steps file version ${JSON.stringify(data.version)} (expected ${STEPS_FILE_VERSION}).` };
  }
  if (!Array.isArray(data.steps)) return { error: "The file has no steps list." };
  if (data.steps.length === 0) return { error: "The file has no steps." };
  if (data.steps.length > MAX_STEPS_IN_FILE) {
    return { error: `Too many steps (${data.steps.length}, max ${MAX_STEPS_IN_FILE}).` };
  }
  const steps: Step[] = [];
  for (const [i, raw] of data.steps.entries()) {
    const at = `Step ${i + 1}`;
    if (!isRecord(raw)) return { error: `${at}: not an object.` };
    if (typeof raw.op !== "string" || !Object.hasOwn(OP_STAGE, raw.op)) {
      return { error: `${at}: unknown op ${JSON.stringify(raw.op)}.` };
    }
    if (typeof raw.target !== "string" || !TARGETS.includes(raw.target as StepTarget)) {
      return { error: `${at}: target must be one of ${TARGETS.join(", ")}.` };
    }
    if (!isRecord(raw.params)) return { error: `${at}: params must be an object.` };
    if (raw.note !== undefined && typeof raw.note !== "string") {
      return { error: `${at}: note must be a string.` };
    }
    steps.push({
      op: raw.op,
      target: raw.target as StepTarget,
      params: raw.params,
      ...(raw.note ? { note: raw.note } : {}),
    });
  }
  return { steps };
}

/** One `APPLY_STEP_BATCH` of adds: new ids, appended, one undo entry. */
export function stepsToOps(steps: Step[]): StepOp[] {
  return steps.map((step) => ({ add: { step } }));
}
