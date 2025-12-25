const vscode = require("vscode");
const getFiles = require("./getFiles.js");
const readFile = require("./readFile.js");
const writeFile = require("./writeFile.js");
const z = require("zod")
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { PromptTemplate } = require("@langchain/core/prompts");

/**
 * @param {vscode.ExtensionContext} context
*/
async function activate(context) {
	
    const disposable = vscode.commands.registerCommand(
        'code-reviewer.reviewFolder',
        async (uri) => {

            if (!uri) {
                vscode.window.showErrorMessage("No folder selected");
                return;
            }

			const outputChannel = vscode.window.createOutputChannel("Code Reviewer");
			outputChannel.show(true);

            const apiKey = await getOrPromptApiKey(context);
            if (!apiKey) return;

            const folderPath = uri.fsPath;

            vscode.window.showInformationMessage(`Selected Folder: ${folderPath}`);
            vscode.window.showInformationMessage(`Your API Key : ${apiKey}`);	
			
            const model = new ChatGoogleGenerativeAI({
                apiKey: apiKey,
                model: "gemini-2.5-flash-lite",
                temperature: 0
            });

			const structure = z.object({
                content: z.string()           
			});

            const prompt = PromptTemplate.fromTemplate(
                `
                You are an AI code reviewer. 
                You will be given a code of file (any programming languages).
                You have to analyze the code proper.
                You have to suggest new proper code with :
                - Bugs removed
                - Errors removed
                - Handled possible exceptions
                - Solve logical errors
                - Solve syntax errors
                - Basically improve the code
                Return the final improved code in proper manner.
                `
            );

			const files = getFiles({dir: folderPath})
			for(const file of files) {

				const original = readFile({path:file}).content
				
                const structuredOutput = model.withStructuredOutput(structure)
                const answer = await structuredOutput.invoke("System Prompt : "+prompt + "\nUser Prompt" + `Code to improve : ${original}`)

				const modified = answer.content
				if (!modified || modified.trim() === original.trim()) {
					vscode.window.showInformationMessage(`No changes for ${file}`);
					continue;
				}
				
				const originalUri = vscode.Uri.parse(`untitled:${file}.original`);
				const modifiedUri = vscode.Uri.parse(`untitled:${file}.ai`);

				// Create original
				const originalEdit = new vscode.WorkspaceEdit();
				originalEdit.insert(originalUri, new vscode.Position(0, 0), original);
				await vscode.workspace.applyEdit(originalEdit);

				// Create modified
				const modifiedEdit = new vscode.WorkspaceEdit();
				modifiedEdit.insert(modifiedUri, new vscode.Position(0, 0), modified);
				await vscode.workspace.applyEdit(modifiedEdit);

				// Show diff ONLY
				await vscode.commands.executeCommand(
					"vscode.diff",
					originalUri,
					modifiedUri,
					`AI Review: ${file}`
				)

				const choice = await vscode.window.showQuickPick(
					["Apply", "Skip"],
					{
						placeHolder: `Apply AI changes to ${file}?`,
						ignoreFocusOut: true
					}
				);

				if(choice == "Apply") {
					writeFile({path:file,content:modified})
					vscode.window.showInformationMessage(`Changes applied to ${file}`);
				}
				else {
					vscode.window.showInformationMessage(`Skipped Changes for ${file}`);
				}
			}

			vscode.window.showInformationMessage(`AI Review complete 🥳`);
		}
    );

    context.subscriptions.push(disposable);
}

/**
 * Prompt user for API key, and store/retrieve using VS Code SecretStorage
 * @param {vscode.ExtensionContext} context
*/

async function getOrPromptApiKey(context) {
    let apiKey = await context.secrets.get('geminiApiKey');
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: "Enter your Google Gemini API Key. Generate one from : https://aistudio.google.com/api-keys (needed for reviewing you code)",
            ignoreFocusOut: true,
            password: true
        });
        if (!apiKey) return null;
        await context.secrets.store('geminiApiKey', apiKey);
    }
    return apiKey;
}

function deactivate() {
	
}

module.exports = {
	activate,
	deactivate
}