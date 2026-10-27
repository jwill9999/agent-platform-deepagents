import { createMiddleware } from "langchain";

// M1 text chat has no tool authority, including built-in delegation. Keep this
// guard at both public hooks: hiding schemas alone does not prevent dispatch.
export const chatOnlyPolicy = createMiddleware({
  name: "GeneralChatOnlyPolicy",
  wrapModelCall: (request, handler) => handler({ ...request, tools: [] }),
  wrapToolCall: () => {
    throw new Error("Tools are disabled for this General Chat connection.");
  },
});
