const fs = require("node:fs");
const vscode = require("vscode");

function writeFile({ path, content }) {
	try {
		fs.writeFileSync(path, content, "utf-8");
		return { success: true };
	} catch (err) {
		switch (err.code) {
			case "EACCES":
			case "EPERM":
				vscode.window.showWarningMessage(`Permission denied: ${path}`);
				break;

			case "ENOENT":
				vscode.window.showWarningMessage(`Path not found: ${path}`);
				break;

			case "ENOSPC":
				vscode.window.showWarningMessage(`No disk space left to write file`);
				break;

			default:
				vscode.window.showWarningMessage(`Failed to write file: ${path}`);
		}

		return { success: false };
	}
}

module.exports = writeFile;