import { readFileTool } from "./readFile";
import { readMultipleFilesTool } from "./readMultipleFiles";
import { writeFileTool } from "./writeFile";
import { runCommandTool } from "./runCommand";
import { listFilesTool } from "./listFiles";
import { editFileTool } from "./editFile";
import { searchWebTool } from "./searchWeb.js";
const TOOLS = {
    readFile: readFileTool,
    readMultipleFiles: readMultipleFilesTool,
    writeFile: writeFileTool,
    editFile: editFileTool,
    runCommand: runCommandTool,
    listFiles: listFilesTool,
    searchWeb: searchWebTool,
};
export const AVAILABLE_TOOLS = Object.keys(TOOLS);
export async function dispatchTool(toolCall) {
    const name = toolCall.name.toLowerCase();
    const handlerName = Object.keys(TOOLS).find((k) => k.toLowerCase() === name) ?? null;
    const handler = handlerName ? TOOLS[handlerName] : null;
    if (!handler || !handlerName) {
        return {
            toolName: toolCall.name,
            success: false,
            output: `Unknown tool: ${toolCall.name}\n` +
                `Available tools: ${AVAILABLE_TOOLS.join(", ")}`,
        };
    }
    try {
        return await handler(toolCall.arguments);
    }
    catch (e) {
        return {
            toolName: toolCall.name,
            success: false,
            output: `Tool '${toolCall.name}' failed with error: ${e.message}\nThis is a recoverable error. Please try a different approach or inform the user.`,
        };
    }
}
