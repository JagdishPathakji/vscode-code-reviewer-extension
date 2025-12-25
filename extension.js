const vscode = require("vscode");
const getFiles = require("./getFiles.js");
const readFile = require("./readFile.js");
const writeFile = require("./writeFile.js");

/**
 * @param {vscode.ExtensionContext} context
 */

async function activate(context) {
	const { GoogleGenAI } = await import("@google/genai");

	const disposable = vscode.commands.registerCommand(
		"code-reviewer-by-jagdish.reviewFolder",
		async (uri) => {
			if (!uri) {
				vscode.window.showErrorMessage("No folder selected");
				return;
			}

			const outputChannel = vscode.window.createOutputChannel("Code Reviewer");
			outputChannel.show(true);

			const apiKey = await getOrPromptApiKey(context);
			if (!apiKey) return;

			const ai = new GoogleGenAI({ apiKey });
			const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						
			if (!folderPath) {
				vscode.window.showErrorMessage("No folder selected and no workspace folder open");
				return;
			}

			const files = getFiles({ dir: folderPath });
			outputChannel.appendLine(`Files found: ${files.length}`);

			const originalUri = vscode.Uri.parse("untitled:AI_REVIEW.original");
			const modifiedUri = vscode.Uri.parse("untitled:AI_REVIEW.ai");


			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "AI Code Review",
				cancellable: true
			}, async (progress, token) => {

				for (let i = 0; i < files.length; i++) {
					const file = files[i];

					if (token.isCancellationRequested) {
						vscode.window.showWarningMessage("AI Review cancelled by user ❌");
						return;
					}

					const original = readFile({ path: file })?.content || null;
					if(!original) continue;

					progress.report({ message: `Reviewing: ${file}`, increment: (1 / files.length) * 100 });

					try {
						const result = await ai.models.generateContent({
							model: "gemini-2.5-flash-lite",
							config: {
								systemInstruction: `
								You are an code reviewer and bug fixer.
								You are here to solve errors and bugs in the code provided to you.
								You have to resolve bugs, errors, possible execeptions, etc.
								You have to solve syntax or logical errors if present in the code.
								You have to properly anaylze the code and fix the code.
								Add comments of whatever changes you have made to the file.
								*Return only the improved code version*.
								`
							},
							contents: [
								{
									role: "user",
									parts: [
										{
											text: `Review and improve this file.
											Return ONLY the full improved code.
											FILE PATH: ${file}
											CODE:${original}`
										}
									]
								}
							]
						});

						const modified = result.text;

						if (!modified || modified.trim() === original.trim()) {
							outputChannel.appendLine(`No changes for ${file}`);
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
							`AI Review`
						);

						const choice = await vscode.window.showQuickPick(
							["Apply", "Skip"],
							{
								placeHolder: `Apply AI changes to ${file}?`,
								ignoreFocusOut: true
							}
						);

						if (choice === "Apply") {
							writeFile({
								path: file,
								content: cleanCodeFences(modified)
							});
							vscode.window.showInformationMessage(`Applied changes to ${file}`);
						} else {
							vscode.window.showInformationMessage(`Skipped ${file}`);
						}

					} catch (error) {
						if(error.status == 429) {
							vscode.window.showErrorMessage(`Error occured : API Limit Reached`);
							return;
						}
						else if(error.status === 401) {
							vscode.window.showErrorMessage(`Error occured : Invalid API Key Provided`);
							return;
						}
						else if(error.status === 403) {
							vscode.window.showErrorMessage("Gemini API access forbidden. Check API enablement or billing.");
							return;
						}
						else if(error.status === 413) {
							vscode.window.showWarningMessage(`Skipping large file: ${file}`);
							continue;
						}
						else if(error.status >= 500) {
							vscode.window.showErrorMessage("Server problem from Gemini side");
							return;
						}
						outputChannel.appendLine(`Error in ${file}: ${error}`);
					}
				}

				vscode.window.showInformationMessage("AI Review complete 🥳");
			});
		}
	);

	context.subscriptions.push(disposable);
}


/**
 * Helpers
 */

function cleanCodeFences(code) {
	return code
		.replace(/^```[a-z]*\n?/i, "")
		.replace(/```$/, "")
		.trim();
}

async function getOrPromptApiKey(context) {
	let apiKey = await context.secrets.get("geminiApiKey");
	if (!apiKey) {
		apiKey = await vscode.window.showInputBox({
			prompt:
				"Enter your Google Gemini API Key. Generate one from: https://aistudio.google.com/api-keys",
			ignoreFocusOut: true,
			password: true
		});
		if (!apiKey) return null;
		await context.secrets.store("geminiApiKey", apiKey);
	}
	return apiKey;
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};





// second way : 

// const vscode = require("vscode");
// const getFiles = require("./getFiles.js");
// const readFile = require("./readFile.js");
// const writeFile = require("./writeFile.js");
// const z = require("zod")
// const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
// const { PromptTemplate } = require("@langchain/core/prompts");

// /**
//  * @param {vscode.ExtensionContext} context
// */
// async function activate(context) {
	
//     const disposable = vscode.commands.registerCommand(
//         'code-reviewer.reviewFolder',
//         async (uri) => {

//             if (!uri) {
//                 vscode.window.showErrorMessage("No folder selected");
//                 return;
//             }

// 			const outputChannel = vscode.window.createOutputChannel("Code Reviewer");
// 			outputChannel.show(true);

//             const apiKey = await getOrPromptApiKey(context);
//             if (!apiKey) return;

//             const folderPath = uri.fsPath;

//             vscode.window.showInformationMessage(`Selected Folder: ${folderPath}`);
//             vscode.window.showInformationMessage(`Your API Key : ${apiKey}`);	
			
//             const model = new ChatGoogleGenerativeAI({
//                 apiKey: apiKey,
//                 model: "gemini-2.5-flash-lite",
//                 temperature: 0
//             });

// 			const structure = z.object({
//                 content: z.string()           
// 			});

//             const prompt = PromptTemplate.fromTemplate(
//                 `
//                 You are an AI code reviewer. 
//                 You will be given a code of file (any programming languages).
//                 You have to analyze the code proper.
//                 You have to suggest new proper code with :
//                 - Bugs removed
//                 - Errors removed
//                 - Handled possible exceptions
//                 - Solve logical errors
//                 - Solve syntax errors
//                 - Basically improve the code
//                 Return the final improved code in proper manner.
//                 `
//             );

// 			const files = getFiles({dir: folderPath})
// 			for(const file of files) {

// 				const original = readFile({path:file}).content
				
// 				try {

// 					outputChannel.appendLine(`got file content`)

// 					const structuredOutput = model.withStructuredOutput(structure)
// 					const answer = await structuredOutput.invoke("System Prompt : "+prompt + "\nUser Prompt" + `Code to improve : ${original}`)
					
// 					outputChannel.appendLine(`llm call complete`)

// 					const modified = answer.content
// 					if (!modified || modified.trim() === original.trim()) {
// 						vscode.window.showInformationMessage(`No changes for ${file}`);
// 						continue;
// 					}
					
// 					const originalUri = vscode.Uri.parse(`untitled:${file}.original`);
// 					const modifiedUri = vscode.Uri.parse(`untitled:${file}.ai`);
	
// 					// Create original
// 					const originalEdit = new vscode.WorkspaceEdit();
// 					originalEdit.insert(originalUri, new vscode.Position(0, 0), original);
// 					await vscode.workspace.applyEdit(originalEdit);
	
// 					// Create modified
// 					const modifiedEdit = new vscode.WorkspaceEdit();
// 					modifiedEdit.insert(modifiedUri, new vscode.Position(0, 0), modified);
// 					await vscode.workspace.applyEdit(modifiedEdit);
	
// 					// Show diff ONLY
// 					await vscode.commands.executeCommand(
// 						"vscode.diff",
// 						originalUri,
// 						modifiedUri,
// 						`AI Review: ${file}`
// 					)
	
// 					const choice = await vscode.window.showQuickPick(
// 						["Apply", "Skip"],
// 						{
// 							placeHolder: `Apply AI changes to ${file}?`,
// 							ignoreFocusOut: true
// 						}
// 					);
	
// 					if(choice == "Apply") {
// 						writeFile({path:file,content:modified})
// 						vscode.window.showInformationMessage(`Changes applied to ${file}`);
// 					}
// 					else {
// 						vscode.window.showInformationMessage(`Skipped Changes for ${file}`);
// 					}
// 				}
// 				catch(error) {
// 					outputChannel.appendLine(`error : ${error}`)
// 				}	
// 			}

// 			vscode.window.showInformationMessage(`AI Review complete 🥳`);
// 		}
//     );

//     context.subscriptions.push(disposable);
// }

// /**
//  * Prompt user for API key, and store/retrieve using VS Code SecretStorage
//  * @param {vscode.ExtensionContext} context
// */

// async function getOrPromptApiKey(context) {
//     let apiKey = await context.secrets.get('geminiApiKey');
//     if (!apiKey) {
//         apiKey = await vscode.window.showInputBox({
//             prompt: "Enter your Google Gemini API Key. Generate one from : https://aistudio.google.com/api-keys (needed for reviewing you code)",
//             ignoreFocusOut: true,
//             password: true
//         });
//         if (!apiKey) return null;
//         await context.secrets.store('geminiApiKey', apiKey);
//     }
//     return apiKey;
// }

// function deactivate() {
	
// }

// module.exports = {
// 	activate,
// 	deactivate
// }