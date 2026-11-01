import { expect, it } from "vitest"
import { canEditCustomIcon } from "./eligibility"

it("shares bookmark content eligibility without treating fixed order as read-only", () => {
  const bookmark = { id: "one", title: "One", url: "https://example.test" }
  expect(canEditCustomIcon(bookmark)).toBe(true)
  expect(canEditCustomIcon({ ...bookmark, orderReadOnly: true })).toBe(true)
  expect(canEditCustomIcon({ ...bookmark, readOnly: true })).toBe(false)
  expect(canEditCustomIcon({ ...bookmark, type: "separator" })).toBe(false)
  expect(canEditCustomIcon({ id: "folder", title: "Folder" })).toBe(false)
})
