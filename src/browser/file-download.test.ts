// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  fileDownloadCapability,
  requestFileDownload,
  saveBlobAs,
  type DownloadApi,
} from "./file-download"

type Delta = Parameters<
  Parameters<DownloadApi["onChanged"]["addListener"]>[0]
>[0]
function downloads() {
  const listeners = new Set<(delta: Delta) => void>()
  const api = {
    download: vi.fn(async () => 7),
    search: vi.fn<DownloadApi["search"]>(async () => [
      { state: "in_progress" },
    ]),
    show: vi.fn(async () => true),
    onChanged: {
      addListener: vi.fn((listener: (delta: Delta) => void) => {
        listeners.add(listener)
      }),
      removeListener: vi.fn((listener: (delta: Delta) => void) => {
        listeners.delete(listener)
      }),
    },
  }
  return {
    api,
    listeners,
    emit: (delta: Delta) => listeners.forEach((listener) => listener(delta)),
  }
}
const blob = new Blob(["{}"], { type: "application/json" })
beforeEach(() => {
  vi.stubGlobal("browser", undefined)
  vi.stubGlobal("chrome", undefined)
  URL.createObjectURL = vi.fn(() => "blob:backup")
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it("requests Save As and reports completion only for its own completed download", async () => {
  const { api, listeners, emit } = downloads()
  const completed = vi.fn()
  const saving = saveBlobAs(api, blob, "icons-2026-11-01.json").then(completed)
  await vi.waitFor(() => expect(api.search).toHaveBeenCalledWith({ id: 7 }))
  expect(api.download).toHaveBeenCalledWith({
    url: "blob:backup",
    filename: "icons-2026-11-01.json",
    saveAs: true,
  })
  emit({ id: 8, state: { current: "complete" } })
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  emit({ id: 7, state: { current: "complete" } })
  await saving
  const result = completed.mock.calls[0][0]
  expect(result.status).toBe("complete")
  await result.showInFolder()
  expect(api.show).toHaveBeenCalledWith(7)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:backup")
  expect(listeners.size).toBe(0)
})

it("catches a download that finishes before its initiation promise resolves", async () => {
  const { api, emit, listeners } = downloads()
  api.download.mockImplementation(async () => {
    emit({ id: 7, state: { current: "complete" } })
    return 7
  })
  api.search.mockResolvedValue([{ state: "complete" }])
  expect((await saveBlobAs(api, blob, "icons.json")).status).toBe("complete")
  expect(listeners.size).toBe(0)
})

it.each([
  new Error("Download canceled by the user"),
  { message: "Download canceled by the user" },
  new Error("USER_CANCELED"),
])(
  "handles Save As cancellation without reporting success: %s",
  async (error) => {
    const { api, listeners } = downloads()
    api.download.mockRejectedValue(error)
    await expect(saveBlobAs(api, blob, "icons.json")).resolves.toEqual({
      status: "cancelled",
    })
    expect(api.search).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  }
)

it.each(["USER_CANCELED", "FILE_FAILED"])(
  "handles download interruption: %s",
  async (error) => {
    const { api, emit, listeners } = downloads()
    const saving = saveBlobAs(api, blob, "icons.json")
    const assertion =
      error === "USER_CANCELED"
        ? expect(saving).resolves.toEqual({ status: "cancelled" })
        : expect(saving).rejects.toThrow("download failed")
    await vi.waitFor(() => expect(api.search).toHaveBeenCalled())
    api.search.mockResolvedValue([{ state: "interrupted", error }])
    emit({ id: 7, state: { current: "interrupted" } })
    await assertion
    expect(listeners.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  }
)

it.each(["initiation", "monitoring", "missing", "invalid-id"])(
  "cleans up when %s fails",
  async (stage) => {
    const { api, listeners } = downloads()
    if (stage === "initiation")
      api.download.mockRejectedValue(new Error("FILE_ACCESS_DENIED"))
    if (stage === "monitoring")
      api.search.mockRejectedValue(new Error("Permission revoked"))
    if (stage === "missing") api.search.mockResolvedValue([])
    if (stage === "invalid-id")
      api.download.mockResolvedValue(undefined as never)
    await expect(saveBlobAs(api, blob, "icons.json")).rejects.toThrow(
      "download failed"
    )
    expect(listeners.size).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    if (stage === "invalid-id") expect(api.search).not.toHaveBeenCalled()
  }
)

it("omits unsupported Show in Folder and reports reveal failures", async () => {
  const { api } = downloads()
  api.search.mockResolvedValue([{ state: "complete" }])
  const result = await saveBlobAs(
    { ...api, show: undefined },
    blob,
    "icons.json"
  )
  expect(result).toEqual({ status: "complete" })
  api.show.mockResolvedValue(false)
  const saved = await saveBlobAs(api, blob, "icons.json")
  if (saved.status !== "complete") throw new Error("Expected complete")
  await expect(saved.showInFolder!()).rejects.toThrow("could not be shown")
})

it("detects declared capability and requests optional access synchronously", async () => {
  expect(fileDownloadCapability()).toBeNull()
  const { api } = downloads()
  const request = vi.fn(async () => false)
  const manifest = { optional_permissions: ["downloads"] }
  vi.stubGlobal("browser", {
    runtime: { id: "test", getManifest: () => manifest },
    permissions: { request },
  })
  const capability = fileDownloadCapability()!
  const permission = capability.requestPermission()
  expect(request).toHaveBeenCalledWith({ permissions: ["downloads"] })
  await expect(permission).resolves.toBe(false)
  await expect(capability.save(blob, "icons.json")).rejects.toThrow(
    "Download access"
  )
  vi.stubGlobal("browser", {
    runtime: {
      id: "test",
      getManifest: () => ({ permissions: ["downloads"] }),
    },
    downloads: api,
  })
  await expect(fileDownloadCapability()!.requestPermission()).resolves.toBe(
    true
  )
  manifest.optional_permissions = []
  vi.stubGlobal("browser", {
    runtime: { id: "test", getManifest: () => manifest },
  })
  expect(fileDownloadCapability()).toBeNull()
})

it("labels fallback exports as requested, never completed", () => {
  vi.useFakeTimers()
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("icons-2026-11-01.json")
      expect(this.href).toBe("blob:backup")
    })
  expect(requestFileDownload(blob, "icons-2026-11-01.json")).toEqual({
    status: "requested",
  })
  expect(click).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:backup")
})
