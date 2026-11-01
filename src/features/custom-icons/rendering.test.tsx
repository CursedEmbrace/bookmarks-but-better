// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Favicon } from "@/features/bookmark-item/favicon"
import { useCustomIconStore } from "@/stores/custom-icon-store"
import { useBookmarkStore } from "@/stores/bookmark-store"

const resolve = vi.fn(async () => ({
  sources: ["https://icons.test/favicon.png"],
}))
vi.mock("@/browser/favicon/resolve", () => ({
  faviconResolver: {
    resolve: (...args: unknown[]) => {
      void args
      return resolve()
    },
    reportMiss: vi.fn(),
  },
}))
afterEach(() => {
  cleanup()
  useCustomIconStore.getState().activate(null)
  useBookmarkStore.setState({ adapter: null })
  resolve.mockClear()
})

describe("custom icon rendering precedence", () => {
  it.each([16, 40])(
    "renders independent images for identical URLs at size %s without favicon requests",
    (size) => {
      useCustomIconStore.setState({
        images: {
          one: "data:image/png;base64,YQ==",
          two: "data:image/png;base64,Yg==",
        },
      })
      const { container } = render(
        <>
          <Favicon
            bookmarkId="one"
            url="https://same.test/page"
            title="One"
            size={size}
          />
          <Favicon
            bookmarkId="two"
            url="https://same.test/page"
            title="Two"
            size={size}
          />
        </>
      )
      const images = container.querySelectorAll("img")
      expect(images[0].src).not.toBe(images[1].src)
      expect(images[0].style.width).toBe(`${size}px`)
      expect(images[0].className).toContain("object-contain")
      expect(resolve).not.toHaveBeenCalled()
    }
  )
  it("resumes website favicon resolution on reset and on a corrupt stored image", async () => {
    useBookmarkStore.setState({
      adapter: {
        favicon: { getUrl: () => "", isAvailable: () => true },
      } as never,
    })
    useCustomIconStore.setState({
      images: { one: "data:image/png;base64,YQ==" },
    })
    const { container, rerender } = render(
      <Favicon bookmarkId="one" url="https://same.test/page" title="One" />
    )
    fireEvent.error(container.querySelector("img")!)
    await waitFor(() =>
      expect(container.querySelector("img")?.src).toBe(
        "https://icons.test/favicon.png"
      )
    )
    useCustomIconStore.setState({ images: {} })
    rerender(
      <Favicon bookmarkId="one" url="https://same.test/page" title="One" />
    )
    await waitFor(() =>
      expect(container.querySelector("img")?.src).toBe(
        "https://icons.test/favicon.png"
      )
    )
  })
})
