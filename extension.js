const vscode = require("vscode");
const getFiles = require("./getFiles.js");
const readFile = require("./readFile.js");
const writeFile = require("./writeFile.js");
const path = require("path");

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

	const { Ollama } = await import("ollama");

	const disposable = vscode.commands.registerCommand(
		"code-reviewer-by-jagdish.reviewFolder",
		async (uri) => {
			if (!uri) {
				vscode.window.showErrorMessage("No folder selected");
				return;
			}

			const apiKey = await getApiKeyWithChoice(context);
			if (!apiKey) return;

			const ollama = new Ollama({
				host: "https://ollama.com",
				headers: {
					Authorization: "Bearer " + apiKey,
				},
			});

			const outputChannel = vscode.window.createOutputChannel("AI Reviewer");
			outputChannel.show(true);

			const selectedPath = uri?.fsPath;
			if (!selectedPath) {
				vscode.window.showErrorMessage("No folder or file selected");
				return;
			}

			let files = [];

			const reviewMode = await vscode.window.showQuickPick(
				[
					"🧠 Full Review",
					"🐞 Bug Fix Only",
					"⚡ Performance Optimization",
					"🔐 Security Review",
					"🧹 Code Cleanup / Refactor",
				],
				{
					placeHolder: "Select AI Review Mode",
					ignoreFocusOut: true
				}
			);

			if (!reviewMode) return;

			try {
				const stat = await vscode.workspace.fs.stat(vscode.Uri.file(selectedPath));
				if (stat.type === vscode.FileType.Directory) {
					files = getFiles({ dir: selectedPath });
				} else {
					files = [selectedPath];
				}
			} catch {
				vscode.window.showErrorMessage(`Unable to access: ${selectedPath}`);
				return;
			}

			const originalUri = vscode.Uri.parse("untitled:AI_REVIEW.original");
			const modifiedUri = vscode.Uri.parse("untitled:AI_REVIEW.ai");

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "AI Code Review",
				cancellable: true
			}, async (progress, token) => {

				// ===== OUTPUT HEADER =====
				outputChannel.appendLine("══════════════════════════════════════════════");
				outputChannel.appendLine("🚀 AI CODE REVIEW SESSION STARTED");
				outputChannel.appendLine(`🧠 Review Mode : ${reviewMode}`);
				outputChannel.appendLine(`📂 Total Files : ${files.length}`);
				outputChannel.appendLine("══════════════════════════════════════════════");

				let summaryStats = {
					filesReviewed: 0,
					filesModified: 0,
					skipped: 0,
					errors: 0,
				};

				for (let i = 0; i < files.length; i++) {
					const file = files[i];

					if (token.isCancellationRequested) {
						vscode.window.showWarningMessage("AI Review cancelled by user ❌");
						return;
					}

					const original = readFile({ path: file })?.content || null;
					if (!original) continue;

					progress.report({
						message: `Reviewing: ${file}`,
						increment: (1 / files.length) * 100
					});

					const baseName = path.basename(file);

					try {
						summaryStats.filesReviewed++;
						outputChannel.appendLine(`🔍 Reviewing file → ${baseName}`);

						const response = await ollama.chat({
							model: "gpt-oss:120b-cloud",
							messages: [
								{
									role: "system",
									content: getSystemPromptByMode(reviewMode)
								},
								{
									role: "user",
									content: `
										Review and improve this file. Return ONLY the full improved code.
										FILE PATH: ${file}
										CODE:
										${original}
									`
								}
							],
							stream: true
						});

						let modified = "";
						for await (const part of response) {
							modified += part.message.content;
						}

						outputChannel.appendLine(`✨ AI suggestions generated for ${baseName}`);

						if (!modified || modified.trim() === original.trim()) {
							vscode.window.showInformationMessage(`No changes for ${baseName}`);
							continue;
						}

						const edit = new vscode.WorkspaceEdit();
						edit.delete(originalUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0));
						edit.delete(modifiedUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0));
						edit.insert(originalUri, new vscode.Position(0, 0), original);
						edit.insert(modifiedUri, new vscode.Position(0, 0), cleanCodeFences(modified));
						await vscode.workspace.applyEdit(edit);

						await vscode.commands.executeCommand(
							"vscode.diff",
							originalUri,
							modifiedUri,
							`AI Review: ${baseName}`
						);

						const choice = await vscode.window.showQuickPick(
							["Apply", "Skip"],
							{
								placeHolder: `Apply AI changes to ${file}?`,
								ignoreFocusOut: true
							}
						);

						if (choice === "Apply") {
							summaryStats.filesModified++;
							writeFile({
								path: file,
								content: cleanCodeFences(modified)
							});
							outputChannel.appendLine(`✅ Changes applied → ${baseName}`);
							vscode.window.showInformationMessage(`Applied changes to ${baseName}`);
						} else {
							summaryStats.skipped++;
							outputChannel.appendLine(`⏭ Changes skipped → ${baseName}`);
							vscode.window.showInformationMessage(`⏭ Skipped ${file}`);
						}

					} catch (error) {
						outputChannel.appendLine("❌ Ollama Error Detected");
						outputChannel.appendLine("--------------------------------");

						outputChannel.appendLine(`Message: ${error.message || "No message"}`);

						if (error.status) {
							outputChannel.appendLine(`HTTP Status: ${error.status}`);
						}

						if (error.response) {
							outputChannel.appendLine("Response:");
							outputChannel.appendLine(JSON.stringify(error.response, null, 2));
						}

						if (error.stack) {
							outputChannel.appendLine("Stack Trace:");
							outputChannel.appendLine(error.stack);
						}

						outputChannel.appendLine("--------------------------------");

						vscode.window.showErrorMessage(
							"AI Review failed. See 'AI Reviewer' output for details."
						);

						summaryStats.errors++;
						continue; 
					}
				}

				const summary = `
					🧠 AI REVIEW SUMMARY
					\n
					📂 Files Reviewed : ${summaryStats.filesReviewed}
					\n
					✅ Files Modified : ${summaryStats.filesModified}
					\n
					⏭ Files Skipped  : ${summaryStats.skipped}
					\n
					❌ Errors        : ${summaryStats.errors}
					\n
					🎯 Review Mode   : ${reviewMode}
					\n
					🚀 Status        : Completed Successfully
				`;

				outputChannel.appendLine("══════════════════════════════════════════════");
				outputChannel.appendLine("📊 AI REVIEW SUMMARY");
				outputChannel.appendLine("══════════════════════════════════════════════");
				outputChannel.appendLine(summary);
				outputChannel.appendLine("══════════════════════════════════════════════");


				vscode.window.showInformationMessage("🎉 AI Review Completed Successfully");
				outputChannel.appendLine("🧹 Cleaning up temporary AI editors...");
				await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			});
		}
	);

	context.subscriptions.push(disposable);
}

/* ================= HELPERS ================= */

function getSystemPromptByMode(mode) {
	const baseRules = `
		You are an expert senior software engineer acting as an automated code reviewer.

		STRICT RULES:
		- Return ONLY the full improved source code.
		- Do NOT include explanations outside code comments.
		- Do NOT wrap output in markdown or code fences.
		- Preserve existing functionality unless explicitly required.
		- Add concise comments ONLY where changes are made.
		- If no improvements are needed, return the original code unchanged.
	`;

	switch (mode) {
		case "🐞 Bug Fix Only":
			return `${baseRules}
			TASK:
			- Identify and fix syntax errors, runtime errors, and logical bugs.
			- Fix potential crashes and unhandled exceptions.
			- Do NOT refactor, optimize, or rename variables unless required.
		`;
		
		case "⚡ Performance Optimization":
			return `${baseRules}
			TASK:
			- Improve time and space efficiency.
			- Remove unnecessary computations or memory usage.
			- Keep behavior exactly the same.
		`;
		
		case "🔐 Security Review":
			return `${baseRules}
			TASK:
			- Fix security vulnerabilities and unsafe patterns.
			- Prevent injections, leaks, and insecure API usage.
		`;
		
		case "🧹 Code Cleanup / Refactor":
			return `${baseRules}
			TASK:
			- Improve readability and maintainability.
			- Simplify code without changing behavior.
		`;

		default:
			return `${baseRules}
			TASK:
			- Fix bugs, improve performance and security.
			- Improve readability with minimal changes.
		`;
	}
}

function cleanCodeFences(code) {
	return code
		.replace(/^```[a-z]*\n?/i, "")
		.replace(/```$/, "")
		.trim();
}

async function getApiKeyWithChoice(context) {
	let apiKey = await context.secrets.get("OLLAMA_API_KEY");

	if (!apiKey) {
		apiKey = await vscode.window.showInputBox({
			prompt: "Enter your Ollama API Key. Get it from : https://ollama.com/settings/keys",
			password: true,
			ignoreFocusOut: true
		});
		if (!apiKey) throw new Error("API key is required");
		await context.secrets.store("OLLAMA_API_KEY", apiKey.trim());
		return apiKey.trim();
	}

	const choice = await vscode.window.showQuickPick(
		["Use saved API key", "Enter a new API key"],
		{ ignoreFocusOut: true }
	);

	if (choice === "Enter a new API key") {
		const newKey = await vscode.window.showInputBox({
			prompt: "Enter new Ollama API Key. Get it from : https://ollama.com/settings/keys",
			password: true,
			ignoreFocusOut: true
		});
		if (!newKey) throw new Error("API key is required");
		await context.secrets.store("OLLAMA_API_KEY", newKey.trim());
		return newKey.trim();
	}

	return apiKey;
}

function deactivate() {}

module.exports = { activate, deactivate };
