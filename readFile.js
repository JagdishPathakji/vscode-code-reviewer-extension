const fs = require("node:fs");
const vscode = require("vscode");

function readFile({ path }) {
	try {
		const content = fs.readFileSync(path, "utf-8");
		return { content };
	} catch (err) {
		switch (err.code) {
			case "ENOENT":
				vscode.window.showWarningMessage(`File not found: ${path}`);
				break;

			case "EACCES":
			case "EPERM":
				vscode.window.showWarningMessage(`Permission denied: ${path}`);
				break;

			case "EISDIR":
				vscode.window.showWarningMessage(`Path is a directory, skipped: ${path}`);
				break;

			default:
				vscode.window.showWarningMessage(`Failed to read file: ${path}`);
		}

		return null;
	}
}

module.exports = readFile;