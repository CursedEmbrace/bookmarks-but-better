export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const ICON_SIZE = 128
export const MAX_ICON_LENGTH = 128 * 1024
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp"

/** Read dimensions before decoding, so compressed oversized images are refused. */
export function inspectImage(bytes: Uint8Array): {
  mime: string
  width: number
  height: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length))
  let mime = ""
  let width = 0
  let height = 0
  if (
    bytes.length >= 24 &&
    bytes
      .slice(0, 8)
      .every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
    ascii(12, 4) === "IHDR"
  ) {
    mime = "image/png"
    width = view.getUint32(16)
    height = view.getUint32(20)
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mime = "image/jpeg"
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
  } else if (
    bytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    mime = "image/webp"
    const kind = ascii(12, 4)
    if (kind === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    } else if (
      kind === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (kind === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true)
      width = 1 + (bits & 0x3fff)
      height = 1 + ((bits >>> 14) & 0x3fff)
    }
  }
  if (!mime || !width || !height)
    throw new Error(
      "Choose a valid PNG, JPEG or WebP image. SVG and other formats are not supported."
    )
  if (width > 8192 || height > 8192 || width * height > 16_000_000)
    throw new Error(
      "This image is too large. Choose an image under 16 megapixels and 8192 pixels per side."
    )
  return { mime, width, height }
}

/** Local raster decode and re-encode strips metadata, preserves alpha and aspect ratio. */
export async function prepareIcon(file: Blob): Promise<string> {
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose an image smaller than 8 MB.")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { mime } = inspectImage(bytes)
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
  try {
    const image = new Image()
    image.src = objectUrl
    try {
      await image.decode()
    } catch {
      throw new Error("This image could not be read. It may be corrupt.")
    }
    const { naturalWidth: width, naturalHeight: height } = image
    if (
      !width ||
      !height ||
      width > 8192 ||
      height > 8192 ||
      width * height > 16_000_000
    )
      throw new Error("This image is too large or could not be read.")
    const scale = Math.min(1, ICON_SIZE / width, ICON_SIZE / height)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext("2d")
    if (!context)
      throw new Error("Image processing is unavailable in this browser.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL("image/png")
    if (!isStoredIcon(result))
      throw new Error("This image could not be optimized. Try another image.")
    return result
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function isStoredIcon(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ICON_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

/** Backups go through the same decoder as local files; data URLs are never trusted. */
export async function prepareBackupIcon(value: unknown): Promise<string> {
  if (!isStoredIcon(value)) throw new Error("Invalid backup image.")
  const binary = atob(value.slice(value.indexOf(",") + 1))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return prepareIcon(new Blob([bytes], { type: "image/png" }))
}
