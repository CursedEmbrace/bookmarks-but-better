// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FilePicker } from "./file-picker"

afterEach(cleanup)
const props = {
  id: "image",
  label: "Choose an image",
  buttonLabel: "Choose image from computer",
  accept: "image/png,image/jpeg,image/webp",
  emptyText: "No image selected.",
}

it("offers one tab stop and opens the native input with mouse, Enter and Space", async () => {
  const user = userEvent.setup()
  render(<FilePicker {...props} onSelect={vi.fn()} />)
  const input = screen.getByLabelText(props.label) as HTMLInputElement
  const button = screen.getByRole("button", { name: props.buttonLabel })
  const click = vi.spyOn(input, "click").mockImplementation(() => {})
  expect(input.type).toBe("file")
  expect(input.accept).toBe(props.accept)
  expect(input.hidden).toBe(true)
  await user.tab()
  expect(document.activeElement).toBe(button)
  await user.keyboard("{Enter}")
  await user.keyboard(" ")
  await user.click(button)
  expect(click).toHaveBeenCalledTimes(3)
  expect(button.getAttribute("aria-describedby")).toBe("image-filename")
  expect(screen.getByText(props.emptyText).getAttribute("aria-live")).toBe(
    "polite"
  )
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
})

it("announces filenames, supports replacement/reselection and preserves selection on cancellation", () => {
  const select = vi.fn()
  render(<FilePicker {...props} onSelect={select} />)
  const input = screen.getByLabelText(props.label) as HTMLInputElement
  const file = new File(["fixture"], "my icon.png", { type: "image/png" })
  for (let i = 0; i < 2; i++)
    fireEvent.change(input, { target: { files: [file] } })
  expect(select).toHaveBeenCalledTimes(2)
  expect(select).toHaveBeenLastCalledWith(file)
  expect(input.value).toBe("")
  expect(screen.getByText("Selected: my icon.png")).toBeTruthy()
  fireEvent.change(input, { target: { files: [] } })
  expect(select).toHaveBeenCalledTimes(2)
  expect(screen.getByText("Selected: my icon.png")).toBeTruthy()
  fireEvent.change(input, {
    target: { files: [new File(["new"], "replacement.webp")] },
  })
  expect(screen.getByText("Selected: replacement.webp")).toBeTruthy()
})

it("disables both controls and removes the action from keyboard navigation", async () => {
  const user = userEvent.setup()
  render(<FilePicker {...props} disabled onSelect={vi.fn()} />)
  const input = screen.getByLabelText(props.label) as HTMLInputElement
  const button = screen.getByRole("button") as HTMLButtonElement
  const click = vi.spyOn(input, "click")
  expect(button.disabled).toBe(true)
  expect(input.disabled).toBe(true)
  await user.tab()
  expect(document.activeElement).not.toBe(button)
  fireEvent.click(button)
  expect(click).not.toHaveBeenCalled()
})

it("associates restore guidance and filename feedback with the visible action", () => {
  render(
    <>
      <p id="help">Choose the saved JSON backup.</p>
      <FilePicker
        {...props}
        label="Restore custom icons from JSON"
        buttonLabel="Choose JSON backup to restore"
        accept=".json,application/json"
        descriptionId="help"
        onSelect={vi.fn()}
      />
    </>
  )
  expect(screen.getByRole("button").getAttribute("aria-describedby")).toBe(
    "image-filename help"
  )
  expect(
    (
      screen.getByLabelText(
        "Restore custom icons from JSON"
      ) as HTMLInputElement
    ).accept
  ).toBe(".json,application/json")
})

it("supports a compact neutral action in a custom row while retaining selection and feedback", async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(
    <FilePicker
      {...props}
      variant="outline"
      size="sm"
      onSelect={select}
      renderLayout={({ control, filename }) => (
        <section aria-label="Restore">
          <header>{control}</header>
          <footer>{filename}</footer>
        </section>
      )}
    />
  )
  const input = screen.getByLabelText(props.label) as HTMLInputElement
  const button = screen.getByRole("button", { name: props.buttonLabel })
  expect(button.classList.contains("bg-input/30")).toBe(true)
  expect(button.classList.contains("min-h-8")).toBe(true)
  expect(button.classList.contains("bg-primary")).toBe(false)
  expect(button.closest("header")).not.toBeNull()
  expect(screen.getByText(props.emptyText).closest("footer")).not.toBeNull()
  const click = vi.spyOn(input, "click").mockImplementation(() => {})
  await user.tab()
  expect(document.activeElement).toBe(button)
  await user.keyboard("{Enter}")
  await user.keyboard(" ")
  expect(click).toHaveBeenCalledTimes(2)
  const file = new File(["fixture"], "chosen.png", { type: "image/png" })
  fireEvent.change(input, { target: { files: [file] } })
  expect(select).toHaveBeenCalledExactlyOnceWith(file)
  expect(
    screen.getByText("Selected: chosen.png").closest("footer")
  ).not.toBeNull()
  expect(button.getAttribute("aria-describedby")).toBe("image-filename")
})
