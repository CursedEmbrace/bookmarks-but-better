// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import type { BrowserAdapter } from "@/browser"
import { usePreferencesStore } from "../preferences-store"
import { ProfileStorageAdapter } from "../profile-storage"

it("keeps compact nested cards opt-in and persists the choice across sources", async () => {
  installFakeIndexedDB()
  const profile = new ProfileStorageAdapter()
  const source = () =>
    ({
      storage: {
        get: async (key: string) => (key === "folderOrder" ? [] : null),
        set: vi.fn(),
        remove: vi.fn(),
      },
    }) as unknown as BrowserAdapter
  const first = source()
  const second = source()
  await usePreferencesStore.getState().init(first)
  expect(usePreferencesStore.getState().compactNestedFolders).toBe(false)

  usePreferencesStore.getState().setCompactNestedFolders(true)
  expect(await profile.get("compactNestedFolders")).toBe(true)
  expect(first.storage.set).not.toHaveBeenCalled()
  await usePreferencesStore.getState().init(second)
  expect(usePreferencesStore.getState().compactNestedFolders).toBe(true)

  usePreferencesStore.getState().setCompactNestedFolders(false)
  expect(await profile.get("compactNestedFolders")).toBe(false)
  await usePreferencesStore.getState().init(first)
  expect(usePreferencesStore.getState().compactNestedFolders).toBe(false)
  expect(second.storage.set).not.toHaveBeenCalled()
})
