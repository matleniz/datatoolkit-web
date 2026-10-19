import { GroupInvariantError } from "../api/types";
import type { Group, Step } from "../api/types";

/**
 * Step groups (datatoolkit-issues#249). ONE module owns every rule the engine
 * enforces on `workspace.groups`, so a change on the engine side is a change
 * here and nowhere else:
 *
 * - groups PARTITION the steps and are CONTIGUOUS slices in step order;
 * - a step with no group gets a singleton group, `g` + its id without the
 *   leading `s` (`s12` -> `g12`, `-2`, `-3`... on a clash), named
 *   `"<op> <target>"`; the engine does the same on load and on PUT, so the
 *   local state equals what the engine answers (no echo PUT);
 * - Studio-made groups are `g` + 8 random base36 chars with at least one
 *   letter (`g<digits>` is reserved for singletons);
 * - a group name is one line of 1 to 80 characters.
 *
 * Every mutation of `workspace.steps` goes through a helper below (or through
 * `applyStepOps`, which uses them) so the groups follow the steps.
 */

const GROUP_ID_PATTERN = /^g[0-9a-z-]{1,32}$/;
/** Longest group id: `g` + 32 characters. */
const GROUP_ID_MAX = 33;
const GROUP_NAME_MAX = 80;
const GROUP_INTENT_MAX = 400;
/** Control characters, U+2028 / U+2029 (the engine refuses them in a name). */
// eslint-disable-next-line no-control-regex
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** The steps and the groups over them, kept in step by the helpers below. */
export interface StepList {
  steps: Step[];
  groups: Group[];
}

/** Why `validateGroups` refused, in the engine's vocabulary (+ two local ones). */
export type GroupRule =
  | "duplicate_group_id"
  | "step_shared"
  | "unknown_step"
  | "not_contiguous"
  | "out_of_order"
  | "invalid_name"
  | "invalid_group"
  | "uncovered_step";

export interface GroupViolation {
  rule: GroupRule;
  group_id: string | null;
  step_id: string | null;
  message: string;
}

/**
 * A group name ready to send: trimmed, 1 to 80 characters, one line (no
 * newline, control character, U+2028 / U+2029). Call it before any PUT that
 * carries a name typed by the user.
 */
export function validateGroupName(name: string): { name: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "A group name cannot be empty." };
  if (trimmed.length > GROUP_NAME_MAX) {
    return { error: `A group name has at most ${GROUP_NAME_MAX} characters (got ${trimmed.length}).` };
  }
  if (NAME_FORBIDDEN.test(trimmed)) {
    return { error: "A group name is one line: no line break or control character." };
  }
  return { name: trimmed };
}

/**
 * The first broken invariant of `groups` over `steps`, or null. Mirrors the
 * engine (partition, contiguous slices in step order, unique ids, valid
 * names) and, stricter than its normalisation, wants every step covered: the
 * helpers below always leave a full partition.
 */
export function validateGroups(steps: Step[], groups: Group[]): GroupViolation | null {
  const pos = new Map(steps.map((s, i) => [s.id, i]));
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const sid of g.step_ids) if (!groupOf.has(sid)) groupOf.set(sid, g.id);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  let cursor = 0;
  for (const g of groups) {
    const bad = ids.has(g.id)
      ? violation("duplicate_group_id", g.id, null, `duplicate group id ${g.id}`)
      : groupShape(g);
    if (bad) return bad;
    ids.add(g.id);
    for (const [n, sid] of g.step_ids.entries()) {
      const at = pos.get(sid);
      if (at === undefined) return violation("unknown_step", g.id, sid, `group ${g.id} names unknown step ${sid}`);
      const other = owner.get(sid);
      if (other !== undefined) {
        return violation("step_shared", g.id, sid, `step ${sid} is in groups ${other} and ${g.id}`);
      }
      owner.set(sid, g.id);
      if (at !== cursor) return gap(steps[cursor], g.id, sid, n === 0 && at > cursor, groupOf);
      cursor += 1;
    }
  }
  const missing = steps[cursor];
  return missing ? violation("uncovered_step", null, missing.id ?? null, `step ${missing.id} is in no group`) : null;
}

const violation = (
  rule: GroupRule,
  group_id: string | null,
  step_id: string | null,
  message: string,
): GroupViolation => ({ rule, group_id, step_id, message });

/** What is wrong with the group on its own (id, size, name, intent), if anything. */
function groupShape(g: Group): GroupViolation | null {
  if (!GROUP_ID_PATTERN.test(g.id)) return violation("invalid_group", g.id, null, `invalid group id ${g.id}`);
  if (g.step_ids.length === 0) return violation("invalid_group", g.id, null, `group ${g.id} is empty`);
  if (g.name.length < 1 || g.name.length > GROUP_NAME_MAX || NAME_FORBIDDEN.test(g.name)) {
    return violation("invalid_name", g.id, null, `group ${g.id} has an invalid name`);
  }
  if (g.intent.length > GROUP_INTENT_MAX) {
    return violation("invalid_group", g.id, null, `group ${g.id} intent is over ${GROUP_INTENT_MAX} characters`);
  }
  return null;
}

/**
 * `sid` of group `gid` is not the next step (`next`). Inside a group that is
 * a gap (not contiguous); at a group's start, `next` belongs to a later group
 * (out of order), to this one (not contiguous) or to none (uncovered).
 */
function gap(
  next: Step | undefined,
  gid: string,
  sid: string,
  atStart: boolean,
  groupOf: Map<string, string>,
): GroupViolation {
  const nextOwner = next?.id === undefined ? undefined : groupOf.get(next.id);
  if (atStart && nextOwner === undefined) {
    return violation("uncovered_step", null, next?.id ?? null, `step ${next?.id} is in no group`);
  }
  const rule = atStart && nextOwner !== gid ? "out_of_order" : "not_contiguous";
  return violation(rule, gid, sid, `group ${gid} breaks the step order at step ${sid} (${rule})`);
}

/** Throws when the groups break an invariant: tests, and `import.meta.env.DEV` guards. */
export function assertValidGroups(steps: Step[], groups: Group[], where = "groups"): void {
  const v = validateGroups(steps, groups);
  if (v) throw new Error(`${where}: ${v.message} (${v.rule})`);
}

/** The singleton id the engine gives `step`: `g12` for `s12`, `-2`, `-3`... on a clash. */
function singletonId(step: Step, taken: Set<string>): string {
  const base = `g${(step.id ?? "").slice(1)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    const suffix = `-${n}`;
    id = base.slice(0, GROUP_ID_MAX - suffix.length) + suffix;
  }
  taken.add(id);
  return id;
}

/** The singleton group of `step`, named `"<op> <target>"`, as the engine builds it. */
function singleton(step: Step, taken: Set<string>): Group {
  return {
    id: singletonId(step, taken),
    name: `${step.op} ${step.target}`.slice(0, GROUP_NAME_MAX),
    intent: "",
    step_ids: [step.id ?? ""],
    origin: "auto",
    // The engine always answers the field; spelled out, the local group is
    // byte-for-byte the stored one.
    produced_by: null,
  };
}

/**
 * `g` + 8 random base36 chars, not in `taken`. Always holds a letter:
 * `g<digits>` is the singleton form (`g12` for `s12`) and must stay theirs.
 */
export function newGroupId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const tail = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
    const id = `g${tail}`;
    if (/[a-z]/.test(tail) && !used.has(id)) return id;
  }
}

/**
 * `groups` made a full partition of `steps`: steps in no group get a
 * singleton (the engine's rule, so local and stored state agree). Groups are
 * kept as they are; the same array when nothing is missing.
 */
export function fillSingletons(steps: Step[], groups: Group[]): Group[] {
  if (validateGroups(steps, groups) === null) return groups;
  return rebuild(steps, groups);
}

/**
 * Scan `steps` in order, grouping each step with its old group while the run
 * continues; a group cut in several runs (steps moved, a step inserted
 * inside) keeps its id on the first run and gets fresh ids on the others;
 * ids no longer in `steps` drop out (an emptied group disappears); steps in
 * no group get a singleton. Always a valid partition. Idempotent.
 */
function rebuild(steps: Step[], groups: Group[]): Group[] {
  const owner = new Map<string, Group>();
  for (const g of groups) for (const sid of g.step_ids) if (!owner.has(sid)) owner.set(sid, g);
  const taken = new Set(groups.map((g) => g.id));
  const used = new Set<string>();
  const out: Group[] = [];
  let open: Group | null = null;
  let openSource: Group | undefined;
  for (const step of steps) {
    const source = step.id === undefined ? undefined : owner.get(step.id);
    if (source && source === openSource && open) {
      open.step_ids.push(step.id!);
      continue;
    }
    if (source) {
      let id = source.id;
      if (used.has(id)) {
        id = newGroupId(taken);
        taken.add(id);
      }
      used.add(id);
      open = { ...source, id, step_ids: [step.id!] };
    } else {
      open = singleton(step, taken);
      used.add(open.id);
    }
    openSource = source;
    out.push(open);
  }
  // A group that came out as it went in stays the same object.
  return out.map((g) => {
    const old = groups.find((x) => x.id === g.id);
    return old && old.step_ids.length === g.step_ids.length && old.step_ids.every((id, i) => id === g.step_ids[i])
      ? old
      : g;
  });
}

/** `list` after `steps` changed: groups follow (see `rebuild`); same groups when still valid. */
function follow(steps: Step[], groups: Group[]): StepList {
  return { steps, groups: validateGroups(steps, groups) === null ? groups : rebuild(steps, groups) };
}

/** `align: true` steps first, order otherwise kept; groups cut at the boundary if needed. */
export function orderList(list: StepList): StepList {
  const align = list.steps.filter((s) => s.align);
  const steps = align.length === 0 || align.length === list.steps.length
    ? list.steps
    : [...align, ...list.steps.filter((s) => !s.align)];
  return follow(steps, list.groups);
}

/** `step` (id already set) added at `index` (the end by default): a singleton, or a split of the group it lands in. */
export function insertStep(list: StepList, step: Step, index: number = list.steps.length): StepList {
  const steps = list.steps.slice();
  steps.splice(index, 0, step);
  return follow(steps, list.groups);
}

/** The step at `index` removed from its group; a group left empty is dropped. */
export function removeStepAt(list: StepList, index: number): StepList {
  if (index < 0 || index >= list.steps.length) return list;
  const steps = list.steps.slice();
  steps.splice(index, 1);
  return follow(steps, list.groups);
}

/** The step at `index` replaced; it keeps its id (hence its group). */
export function replaceStepAt(list: StepList, index: number, step: Step): StepList {
  const old = list.steps[index];
  if (!old) return list;
  const steps = list.steps.slice();
  steps[index] = old.id === undefined ? step : { ...step, id: old.id };
  return follow(steps, list.groups);
}

/** Steps replaced wholesale (ids filled): groups keep the steps they still name. */
export function setSteps(list: StepList, steps: Step[]): StepList {
  return follow(steps, list.groups);
}

/**
 * Group `groupId` moved to position `to` among the groups; its steps move with
 * it, so each group stays a contiguous slice. A `to` out of range clamps.
 */
export function moveGroup(list: StepList, groupId: string, to: number): StepList {
  const from = list.groups.findIndex((g) => g.id === groupId);
  if (from < 0) return list;
  const groups = list.groups.slice();
  const [moved] = groups.splice(from, 1);
  groups.splice(Math.max(0, Math.min(to, groups.length)), 0, moved!);
  const byId = new Map(list.steps.map((s) => [s.id, s]));
  const steps = groups.flatMap((g) => g.step_ids.map((id) => byId.get(id)!));
  return orderList({ steps, groups });
}

/** Same groups: same ids, names, intents, origins and steps (a missing `produced_by` is a null one). */
export function sameGroups(a: Group[], b: Group[]): boolean {
  const canon = (g: Group) => ({ ...g, produced_by: g.produced_by ?? null });
  return JSON.stringify(a.map(canon)) === JSON.stringify(b.map(canon));
}

const RULE_TEXT: Record<string, string> = {
  duplicate_group_id: "two groups share an id",
  step_shared: "a step is in two groups",
  unknown_step: "a group names a step that does not exist",
  not_contiguous: "a group is not a contiguous run of steps",
  out_of_order: "groups are not in step order",
  invalid_name: "a group name is not valid (one line, 1 to 80 characters)",
};

/**
 * A group-invariant 422 as a typed error, or null for any other failure. Uses
 * the `detail` {rule, group_id, step_id} the engine adds to those 422s, and
 * falls back on the message when `detail` is missing (a field error in the
 * same body hides it).
 */
export function groupInvariantError(status: number, body: unknown): GroupInvariantError | null {
  if (status !== 422 || typeof body !== "object" || body === null) return null;
  const { type, message, detail, details } = body as Record<string, unknown>;
  if (typeof message !== "string") return null;
  const d = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : null;
  const rule = typeof d?.rule === "string" ? d.rule : null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  if (rule === null) {
    const msgs = Array.isArray(details)
      ? details.flatMap((x) => (typeof x?.msg === "string" ? [x.msg as string] : []))
      : [];
    const hit = [message, ...msgs].some((m) => /\bgroups?\b/i.test(m) && !/\bgroup_by\b/.test(m));
    if (!hit) return null;
  }
  const groupId = text(d?.group_id);
  const stepId = text(d?.step_id);
  const where = [groupId && `group ${groupId}`, stepId && `step ${stepId}`].filter(Boolean).join(", ");
  const why = (rule && RULE_TEXT[rule]) || "the step groups are inconsistent";
  return new GroupInvariantError(
    typeof type === "string" ? type : "KeyParamsError",
    `Step groups refused by the engine${where ? ` (${where})` : ""}: ${why}. ${message}`,
    { rule, groupId, stepId },
  );
}
