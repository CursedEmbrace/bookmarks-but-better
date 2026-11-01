// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  inspectImage,
  MAX_IMAGE_BYTES,
  prepareBackupIcon,
  prepareIcon,
} from "./image"

function png(width = 256, height = 128) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([73, 72, 68, 82], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
function file(bytes: Uint8Array) {
  return { size: bytes.length, arrayBuffer: async () => bytes.buffer } as Blob
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("custom image processing", () => {
  it("recognizes PNG, JPEG and WebP bytes independently of filenames or MIME labels", () => {
    expect(inspectImage(png())).toEqual({
      mime: "image/png",
      width: 256,
      height: 128,
    })
    const jpeg = new Uint8Array([255, 216, 255, 192, 0, 7, 8, 0, 20, 0, 40])
    expect(inspectImage(jpeg)).toEqual({
      mime: "image/jpeg",
      width: 40,
      height: 20,
    })
    const webp = new Uint8Array(30)
    webp.set(new TextEncoder().encode("RIFF"))
    webp.set(new TextEncoder().encode("WEBPVP8X"), 8)
    webp[24] = 39
    webp[27] = 19
    expect(inspectImage(webp)).toEqual({
      mime: "image/webp",
      width: 40,
      height: 20,
    })
  })
  it("rejects SVG, corrupt headers, huge dimensions and files over the byte limit before decoding", async () => {
    expect(() => inspectImage(new TextEncoder().encode("<svg/>"))).toThrow(
      "PNG, JPEG or WebP"
    )
    expect(() => inspectImage(new Uint8Array(24))).toThrow()
    expect(() => inspectImage(png(8000, 8000))).toThrow("16 megapixels")
    await expect(
      prepareIcon({ size: MAX_IMAGE_BYTES + 1 } as Blob)
    ).rejects.toThrow("8 MB")
    await expect(
      prepareBackupIcon("data:image/svg+xml;base64,PHN2Zy8+")
    ).rejects.toThrow()
  })
  it("resizes proportionally, uses a transparent PNG canvas and releases the temporary URL", async () => {
    const draw = vi.fn()
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D)
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,YQ==")
    vi.stubGlobal(
      "Image",
      class {
        src = ""
        naturalWidth = 256
        naturalHeight = 128
        decode = async () => {}
      }
    )
    URL.createObjectURL = vi.fn(() => "blob:local")
    URL.revokeObjectURL = vi.fn()
    expect(await prepareIcon(file(png()))).toBe("data:image/png;base64,YQ==")
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 128, 64)
    expect(encode).toHaveBeenCalledWith("image/png")
    expect((context.mock.instances[0] as HTMLCanvasElement).width).toBe(128)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local")
  })
  it("reports decoder failures and always releases its object URL", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = ""
        decode = async () => {
          throw new Error("decode failed")
        }
      }
    )
    URL.createObjectURL = vi.fn(() => "blob:bad")
    URL.revokeObjectURL = vi.fn()
    await expect(prepareIcon(file(png()))).rejects.toThrow("corrupt")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:bad")
  })
})
