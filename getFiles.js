const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

function getFiles({ dir }) {
	const files = [];

	const extensions = [
		".html", ".css", ".scss", ".sass",
		".js", ".jsx", ".ts", ".tsx",
		".py",
		".c", ".cpp", ".h", ".hpp",
		".java",
		".cs",
		".go",
		".rs",
		".php",
		".rb",
		".json", ".yaml", ".yml",
		".xml",
		".sql",
		".sh",
		".env"
	];

	const ignoreDirs = [
		"node_modules",
		"dist",
		"build",
		"out",
		".next",
		".nuxt",
		".vercel",
		".turbo",
		".cache",
		".git",
		".github",
		".vscode",
		"coverage",
		"vendor",
		"target",
		"bin",
		"obj"
	];

	let items;
	try {
		items = fs.readdirSync(dir);
	} catch (err) {
		switch (err.code) {
			case "ENOENT":
				vscode.window.showWarningMessage(`Directory not found: ${dir}`);
				break;
			case "EACCES":
			case "EPERM":
				vscode.window.showWarningMessage(`Permission denied: ${dir}`);
				break;
			default:
				vscode.window.showWarningMessage(`Failed to read directory: ${dir}`);
		}
		return files;
	}

	for (const item of items) {
		if (ignoreDirs.includes(item)) continue;

		const fullpath = path.join(dir, item);

		let stat;
		try {
			stat = fs.statSync(fullpath);
		} catch {
			continue; // deleted / broken symlink
		}

		if (stat.isDirectory()) {
			files.push(...getFiles({ dir: fullpath }));
		} else if (stat.isFile()) {
			const ext = path.extname(item);
			if (extensions.includes(ext)) {
				files.push(fullpath);
			}
		}
	}

	return files;
}

module.exports = getFiles;