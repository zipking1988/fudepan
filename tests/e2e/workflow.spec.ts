import { expect, test } from "@playwright/test";
import {
  createUser,
  seedAwaitingTask,
  seedHousehold,
  seedTextNote,
  signIn,
  taskStatus,
} from "./helpers/seed";

test.describe.configure({ mode: "serial" });

test("a new user signs in and creates a household", async ({ page }) => {
  const user = await createUser("new");
  await signIn(page, user);

  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Fudepan" })).toBeVisible();
  await page.getByLabel("Household name").fill("Test Family");
  await page.getByLabel("Your name in this household").fill("Test Parent");
  await page.getByRole("button", { name: "Create household" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Note Inbox" })).toBeVisible();
  await expect(page.getByTestId("active-household")).toContainText("Test Family");
  await expect(page.getByTestId("active-household")).toContainText("Coordinator");
});

test("a coordinator sees the household board with filters", async ({ page }) => {
  const h = await seedHousehold();
  await seedAwaitingTask(h, "Collect test prescription");
  await signIn(page, h.coordinator, "/board");

  await expect(page.getByRole("heading", { level: 1, name: "Household Board" })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "Collect test prescription" });
  await expect(card).toContainText("Needs approval");
  await expect(card).toContainText("High risk");
  await expect(card).toContainText("Medication");
  await expect(card).toContainText("Unassigned");
  await expect(card.getByRole("link", { name: /Original note available/ })).toBeVisible();

  // Claim from the board.
  await card.getByRole("button", { name: /Take this task/ }).click();
  await expect(card).toContainText("Test Coordinator");

  // Filters narrow the list.
  await page.getByLabel("Risk level").selectOption("low");
  await page.getByRole("button", { name: "Show tasks" }).click();
  await expect(page).toHaveURL(/risk=low/);
  await expect(
    page.getByRole("article").filter({ hasText: "Collect test prescription" }),
  ).toHaveCount(0);
});

test("a caregiver creates a draft from a note and edits it", async ({ page }) => {
  const h = await seedHousehold();
  const noteId = await seedTextNote(h, "Take test vitamins at 8\nask the pharmacy");
  await signIn(page, h.caregiver, `/notes/${noteId}/review`);

  await expect(page.getByRole("heading", { level: 1, name: "Review as a task" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Original note" })).toContainText(
    "Take test vitamins",
  );

  await page.getByLabel(/^Title/).fill("Take test vitamins");
  await page.getByLabel(/^Category/).selectOption("medication");
  await expect(page.getByText("High risk").first()).toBeVisible();
  await page.getByLabel(/^Due date/).fill("2030-01-05");
  await expect(page.getByText(/No time was written/)).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { name: /Draft saved/ })).toBeVisible();
  await expect(page.getByText(/It is not confirmed/)).toBeVisible();
  await page.getByRole("link", { name: "Open the task" }).click();

  await expect(page.getByTestId("task-title")).toHaveText("Take test vitamins");
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel(/^Title/).fill("Take test vitamins after breakfast");
  await page.getByLabel(/^Due time/).fill("08:30");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByTestId("task-title")).toHaveText("Take test vitamins after breakfast");
  const timeline = page.getByRole("region", { name: "Activity timeline" });
  await expect(timeline).toContainText("Test Caregiver saved a draft task.");
  await expect(timeline).toContainText("Test Caregiver edited the task.");
  await expect(timeline).toContainText(/Changed: title, due date/);
});

test("a caregiver approves a high-risk task explicitly", async ({ page }) => {
  const h = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Pick up test eye drops");
  await signIn(page, h.caregiver, `/tasks/${taskId}`);

  await expect(
    page.getByText("This is a high-risk task. A caregiver or coordinator must approve it."),
  ).toBeVisible();
  await expect(page.getByText(/does not pay, book, or send anything/)).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve this task" });
  await expect(approve).toBeDisabled();
  await page.getByLabel("I checked this task against the original note.").check();
  await approve.click();

  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  const timeline = page.getByRole("region", { name: "Activity timeline" });
  await expect(timeline).toContainText("Test Coordinator asked for approval.");
  await expect(timeline).toContainText("Test Caregiver approved the task.");
  await expect(timeline).toContainText("Nothing was paid, booked, or sent.");

  const row = await taskStatus(taskId);
  expect(row.status).toBe("confirmed");
  expect(row.approved_by).toBe(h.members.caregiver);
});

test("an elder cannot approve a high-risk task, in the UI or through the API", async ({ page }) => {
  const h = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Pay test water bill");
  await signIn(page, h.elder, `/tasks/${taskId}`);

  await expect(page.getByTestId("task-title")).toHaveText("Pay test water bill");
  await expect(page.getByText(/waiting for a caregiver or coordinator to approve/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit task" })).toHaveCount(0);

  const res = await page.request.post(`/api/tasks/${taskId}/actions`, {
    data: { action: "approve", acknowledged: true },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(res.status()).toBe(403);

  // A forged body with a status or approver is rejected outright.
  const forged = await page.request.post(`/api/tasks/${taskId}/actions`, {
    data: { action: "approve", acknowledged: true, status: "confirmed" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(forged.status()).toBe(400);

  expect((await taskStatus(taskId)).status).toBe("awaiting_confirmation");
});

test("a user from another household cannot see or approve the task", async ({ page }) => {
  const h = await seedHousehold();
  const other = await seedHousehold();
  const taskId = await seedAwaitingTask(h, "Book test clinic visit");
  await signIn(page, other.coordinator, `/tasks/${taskId}`);

  await expect(page.getByText(/could not find this task/)).toBeVisible();
  const res = await page.request.post(`/api/tasks/${taskId}/actions`, {
    data: { action: "approve", acknowledged: true },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(res.status()).toBe(404);
  expect((await taskStatus(taskId)).status).toBe("awaiting_confirmation");
});
