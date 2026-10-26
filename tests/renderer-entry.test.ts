// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
const root = vi.hoisted(() => ({ render: vi.fn(), create: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: root.create }));
vi.mock("../apps/desktop/src/renderer/App.js", () => ({ App: () => null }));
test("renderer entry mounts the application into its document root", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root.create.mockReturnValue({ render: root.render });
  await import("../apps/desktop/src/renderer/main.js");
  expect(root.create).toHaveBeenCalledWith(document.getElementById("root"));
  expect(root.render).toHaveBeenCalledOnce();
});
