import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { admin, seedAwaitingTask, seedHousehold, signIn } from "./helpers/seed";

test("an approved task can be downloaded as a calendar file, and the export is audited", async ({
  page,
}) => {
  const h = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Collect test hearing aid", "2030-03-01T10:00:00+09:00");

  await signIn(page, h.caregiver, `/tasks/${taskId}`);
  await expect(page.getByRole("button", { name: /Download calendar file/ })).toHaveCount(0);
  await page.getByLabel("I checked this task against the original note.").check();
  await page.getByRole("button", { name: "Approve this task" }).click();
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();

  // The elder can add an approved family task to their own calendar.
  await signIn(page, h.elder, `/tasks/${taskId}`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download calendar file/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("collect-test-hearing-aid.ics");
  const ics = await readFile((await download.path())!, "utf8");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("SUMMARY:Collect test hearing aid");
  expect(ics).toContain("DTSTART:20300301T010000Z");

  const { data: events } = await admin()
    .from("audit_events")
    .select("event_type, actor_id, payload")
    .eq("task_id", taskId)
    .eq("event_type", "calendar_event_created");
  expect(events).toHaveLength(1);
  expect(events![0]).toMatchObject({ actor_id: h.elder.id, payload: { method: "ics_download" } });

  await page.reload();
  await expect(page.getByRole("region", { name: "Activity timeline" })).toContainText(
    "Test Elder downloaded a calendar file for this task.",
  );
});

test("unapproved tasks and other households cannot be exported", async ({ page }) => {
  const h = await seedHousehold();
  const other = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Test clinic visit", "2030-03-01T10:00:00+09:00");

  await signIn(page, h.coordinator, `/tasks/${taskId}`);
  const origin = new URL(page.url()).origin;
  expect(
    (await page.request.post(`/api/tasks/${taskId}/calendar`, { headers: { origin } })).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(`/api/tasks/${taskId}/calendar`, {
        headers: { origin: "https://evil.test" },
      })
    ).status(),
  ).toBe(403);

  await signIn(page, other.coordinator, "/");
  expect(
    (await page.request.post(`/api/tasks/${taskId}/calendar`, { headers: { origin } })).status(),
  ).toBe(404);
});
