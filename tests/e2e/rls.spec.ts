import { expect, test } from "@playwright/test";
import { browserClientFor, seedAwaitingTask, seedHousehold, taskStatus } from "./helpers/seed";

/** Goes around the app and talks to Supabase directly with the public anon key. */
test("the public API key cannot bypass approval or forge audit events", async () => {
  const h = await seedHousehold();
  const other = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Collect test inhaler");

  for (const user of [h.coordinator, h.caregiver, h.elder]) {
    const db = await browserClientFor(user);

    // Members can read their own household's task.
    const { data: visible } = await db.from("tasks").select("id").eq("id", taskId);
    expect(visible).toHaveLength(1);

    // Nobody can write tasks directly, even a coordinator.
    const upd = await db
      .from("tasks")
      .update({ status: "confirmed", approved_by: h.members.coordinator })
      .eq("id", taskId);
    expect(upd.error).not.toBeNull();
    const ins = await db
      .from("tasks")
      .insert({ household_id: h.householdId, title: "x", category: "other", risk_level: "low" });
    expect(ins.error).not.toBeNull();

    // Workflow functions are server-only.
    const rpc = await db.rpc("apply_task_action", {
      p_actor: user.id,
      p_task_id: taskId,
      p_action: "approve",
      p_changes: {},
      p_payload: {},
    });
    expect(rpc.error).not.toBeNull();

    // Approval events cannot be forged.
    const forged = await db.from("audit_events").insert({
      household_id: h.householdId,
      task_id: taskId,
      actor_id: user.id,
      event_type: "task_approved",
      payload: {},
    });
    expect(forged.error).not.toBeNull();

    // Members cannot add themselves to other roles or households.
    const join = await db.from("members").insert({
      household_id: other.householdId,
      user_id: user.id,
      display_name: "x",
      role: "coordinator",
    });
    expect(join.error).not.toBeNull();
  }

  // Another household sees nothing.
  const outsider = await browserClientFor(other.coordinator);
  const { data: hidden } = await outsider.from("tasks").select("id").eq("id", taskId);
  expect(hidden).toEqual([]);
  const { data: hiddenEvents } = await outsider
    .from("audit_events")
    .select("id")
    .eq("task_id", taskId);
  expect(hiddenEvents).toEqual([]);

  const elder = await browserClientFor(h.elder);
  const role = await elder
    .from("members")
    .update({ role: "coordinator" })
    .eq("id", h.members.elder);
  expect(role.error).not.toBeNull();

  expect((await taskStatus(taskId)).status).toBe("awaiting_confirmation");
});
