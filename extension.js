const vscode = require("vscode");
const getFiles = require("./getFiles.js");
const readFile = require("./readFile.js");
const writeFile = require("./writeFile.js");
const path = require("path");

/**
 * @param {vscode.ExtensionContext} context
 */

async function activate(context) {

	const { Ollama } = await import("ollama")

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

			// const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
						
			// if (!folderPath) {
			// 	vscode.window.showErrorMessage("No folder selected and no workspace folder open");
			// 	return;
			// }
			// const files = getFiles({ dir: folderPath });


			const selectedPath = uri?.fsPath;
			if (!selectedPath) {
				vscode.window.showErrorMessage("No folder or file selected");
				return;
			}

			let files = [];
			try {
				const stat = await vscode.workspace.fs.stat(vscode.Uri.file(selectedPath));
				if(stat.type===vscode.FileType.Directory) {
					files = getFiles({dir:selectedPath})
				}
				else {
					files = [selectedPath]
				}
			}
			catch(error) {
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

				outputChannel.appendLine("AI Reviewer extension activated");
				for (let i = 0; i < files.length; i++) {
					const file = files[i];

					if (token.isCancellationRequested) {
						vscode.window.showWarningMessage("AI Review cancelled by user ❌");
						return;
					}

					const original = readFile({ path: file })?.content || null;
					if(!original) continue;

					progress.report({ message: `Reviewing: ${file}`, increment: (1 / files.length) * 100 });
					const baseName = path.basename(file);
					try {
						
						outputChannel.appendLine(`Analyzing your file : ${baseName}`);
						const response = await ollama.chat({
							model: "gpt-oss:120b-cloud",
							messages: [
								{
									role:"system",
									content: `
									SystemInstruction : You are an code reviewer and bug fixer.
									You are here to solve errors and bugs in the code provided to you.
									You have to resolve bugs, errors, possible execeptions, etc.
									You have to solve syntax or logical errors if present in the code.
									You have to properly anaylze the code and fix the code.
									Add comments of whatever changes you have made to the file.
									*Return only the improved code version*.
									`
								},
								{ 
									role: "user", 
									content: `
									Review and improve this file. Return ONLY the full improved code. 
									FILE PATH: ${file} CODE:${original}
									`
								}
						],
							stream: true
						});
						
						outputChannel.appendLine("☺️ Your improved version of file is ready");
						let modified = ""
						for await (const part of response) {
							modified += part.message.content;
						}

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
							outputChannel.appendLine(`Changes saved successfully for file : ${baseName}`);
							writeFile({
								path: file,
								content: cleanCodeFences(modified)
							});
							vscode.window.showInformationMessage(`Applied changes to ${baseName}`);
						} else {
							outputChannel.appendLine(`Skipping the changes for file : ${baseName}`);
							vscode.window.showInformationMessage(`Skipped ${file}`);
						}

					} catch (error) {
						outputChannel.appendLine(`Unexpected Error Occured`);
						vscode.window.showInformationMessage(`Error in ${file}: ${error}`);
						return
					}
				}
				
				vscode.window.showInformationMessage("AI Review Completed Successfully");
				outputChannel.appendLine("Closing temporary AI editors...");
				await vscode.commands.executeCommand("workbench.action.closeAllEditors");
				outputChannel.dispose();
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

async function getApiKeyWithChoice(context) {
	let apiKey = await context.secrets.get("OLLAMA_API_KEY");

  	// First time user → no choice needed
  	if(!apiKey) {
    	apiKey = await vscode.window.showInputBox({
      		prompt: "Enter your Ollama API Key",
      		password: true,
      		ignoreFocusOut: true
    	});

		if (!apiKey) {
		throw new Error("API key is required to continue");
		}

		await context.secrets.store("OLLAMA_API_KEY", apiKey.trim());
		return apiKey.trim();
	}

  	// Ask user whether to reuse or replace
  	const choice = await vscode.window.showQuickPick(
    	["Use saved API key", "Enter a new API key"],
    	{
      		placeHolder: "Choose which API key to use",
      		ignoreFocusOut: true
    	}
  	);

  	if(choice === "Enter a new API key") {
    	const newKey = await vscode.window.showInputBox({
      		prompt: "Enter new Ollama API Key",
      		password: true,
      		ignoreFocusOut: true
    	});

    	if(!newKey) {
      		throw new Error("API key is required to continue");
    	}

    	await context.secrets.store("OLLAMA_API_KEY", newKey.trim());
    	return newKey.trim();
  	}

  	// Default: use saved key
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