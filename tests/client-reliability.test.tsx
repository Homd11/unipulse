// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreateTaskModal from "@/components/CreateTaskModal";
import TaskDetailModal from "@/components/TaskDetailModal";
import ProfileModal from "@/components/ProfileModal";
import { TaskItem, UserProfile } from "@/types/app";

afterEach(cleanup);
const student: UserProfile = { id: "student-a", displayName: "Student", avatarColor: "#123456", quietHoursStart: "01:00", quietHoursEnd: "08:00" };
const task: TaskItem = { id: "task-a", groupId: null, createdBy: student.id, creatorName: "Student", title: "Assignment", description: "Original", category: "personal", dueAt: "2026-12-01T12:00:00Z", defaultReminderMinutes: 120, createdAt: "2026-10-01T12:00:00Z", attachments: [], comments: [], memberStatuses: [] };
const detailProps = { task, currentUser: student, onClose: vi.fn(), onAddComment: vi.fn().mockResolvedValue(undefined), onUploadAttachment: vi.fn().mockResolvedValue(undefined), onClaimOnMe: vi.fn().mockResolvedValue(undefined), onToggleDone: vi.fn().mockResolvedValue(undefined), onEditTask: vi.fn().mockResolvedValue(undefined) };

describe("student draft recovery", () => {
  it("locks a task draft until its pending save finishes", async () => {
    let finish!: () => void;
    const view = render(<CreateTaskModal open groups={[]} defaultSpaceId={null} onClose={vi.fn()} onCreateTask={() => new Promise<void>(resolve => { finish = resolve; })} />);
    const title = view.container.querySelector("input[type=text]") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Pending draft" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(title.matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "Close modal" }) as HTMLButtonElement).disabled).toBe(true);
    finish();
  });
  it("retains a failed task draft and displays the server error", async () => {
    const close = vi.fn();
    const { container } = render(<CreateTaskModal open groups={[]} defaultSpaceId={null} onClose={close} onCreateTask={async () => { throw new Error("Storage unavailable"); }} />);
    fireEvent.change(container.querySelector("input[type=text]")!, { target: { value: "Important draft" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Storage unavailable"));
    expect((container.querySelector("input[type=text]") as HTMLInputElement).value).toBe("Important draft");
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps a failed comment available to retry", async () => {
    render(<TaskDetailModal {...detailProps} onAddComment={async () => { throw new Error("Comment not saved"); }} />);
    const input = screen.getByPlaceholderText("Add a comment, clarification, or link...");
    fireEvent.change(input, { target: { value: "Please save this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Comment not saved"));
    expect((input as HTMLInputElement).value).toBe("Please save this");
  });

  it("does not allow new comment text to be lost while the previous send is pending", () => {
    render(<TaskDetailModal {...detailProps} onAddComment={() => new Promise<void>(() => {})} />);
    const input = screen.getByPlaceholderText("Add a comment, clarification, or link...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "First comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    expect(input.disabled).toBe(true);
  });

  it("preserves edits when a server refresh replaces the same task object", () => {
    const view = render(<TaskDetailModal {...detailProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    const title = view.container.querySelector("input[type=text]")!;
    fireEvent.change(title, { target: { value: "Unsaved edit" } });
    view.rerender(<TaskDetailModal {...detailProps} task={{ ...task, comments: [] }} />);
    expect((view.container.querySelector("input[type=text]") as HTMLInputElement).value).toBe("Unsaved edit");
    expect(screen.getByRole("button", { name: "Edit task" }).textContent).toContain("Cancel");
  });
});

it("keeps unsaved quiet hours when polling returns the same saved profile", () => {
  const props = { open: true, users: [], authenticatedUser: student, onClose: vi.fn(), onLogin: vi.fn(), onRegister: vi.fn(), onLogout: vi.fn() };
  const view = render(<ProfileModal {...props} />);
  fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "22:00" } });
  view.rerender(<ProfileModal {...props} authenticatedUser={{ ...student }} />);
  expect((screen.getByLabelText("Quiet hours start") as HTMLInputElement).value).toBe("22:00");
});

it("allows College ID sign-in with an empty public directory and recovers from network errors", async () => {
  render(<ProfileModal open users={[]} authenticatedUser={null} onClose={vi.fn()} onLogin={async () => { throw new Error("Network unavailable"); }} onRegister={vi.fn()} onLogout={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("College / University ID"), { target: { value: "20220145" } });
  fireEvent.change(screen.getByLabelText("4-Digit Security PIN *"), { target: { value: "4829" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify PIN & Sign In" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network unavailable"));
  expect((screen.getByRole("button", { name: "Verify PIN & Sign In" }) as HTMLButtonElement).disabled).toBe(false);
});
