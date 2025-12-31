// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const http = require('http');
const { marked } = require('marked');
const hljs = require('highlight.js');
const fs = require('fs');
const path = require('path');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

const OUTPUT_CHANNEL_NAME = 'Swise Extension';
// [CONFIGURATION]
const EXTENSION_TITLE = 'Swise Extension';
const SERVICE_BASE_URL_CONFIG = 'http://0.0.0.0:3500';
const EXTENSION_ID = 'swiseExtension';
/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

	// Create output channel for logging errors and messages
	const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log(`Congratulations, your extension "${EXTENSION_TITLE}" is now active!`);
	outputChannel.appendLine(`${EXTENSION_TITLE} activated successfully`);

	// Check service health at startup
	try {
		await checkServiceHealth(outputChannel);
		vscode.window.showInformationMessage(`${EXTENSION_TITLE}: Completion Service is available.`);
	} catch (error) {
		const config = vscode.workspace.getConfiguration(EXTENSION_ID);
		const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
		const errorMessage = `${EXTENSION_TITLE}: Completion Service is not available at ${baseUrl}/health. Error: ${error.message}`;

		vscode.window.showErrorMessage(errorMessage, 'Open settings', 'Ignore')
			.then(selection => {
				if (selection === 'Open settings') {
					vscode.commands.executeCommand('workbench.action.openSettings', `${EXTENSION_ID}.serviceBaseUrl`);
				}
			});
		outputChannel.show();
	}

	// Configure marked with highlight.js
	marked.setOptions({
		highlight: function(code, lang) {
			if (lang && hljs.getLanguage(lang)) {
				try {
					return hljs.highlight(code, { language: lang }).value;
				} catch (err) {
					// Fallback to auto-highlighting
				}
			}
			return hljs.highlightAuto(code).value;
		},
		breaks: true,
		gfm: true
	});


	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand(`${EXTENSION_ID}.helloWorld`, function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage(`Hello World from ${EXTENSION_ID}!`);
	});

	// Register the streaming service command
	const streamingDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.callService`, async function () {
		// Create and show webview panel with form anchored to the right
		const iconPath = vscode.Uri.joinPath(context.extensionUri, 'robot-icon.svg');
		const panel = vscode.window.createWebviewPanel(
			'serviceForm',
			EXTENSION_TITLE,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		// Set the icon for the webview panel
		panel.iconPath = iconPath;

		panel.webview.html = getWebviewContent();

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'submitRequest':
						const userInput = message.text;
						if (userInput && userInput.trim().length > 0) {
							// Add request header to conversation history
							const initialContent = `\n\n---\n\n**Request:** ${userInput}\n\n**Response:**\n\n`;
							panel.webview.postMessage({
								command: 'appendResults',
								content: initialContent,
								isMarkdown: true
							});

							// Start progress animation
							panel.webview.postMessage({
								command: 'startProgress'
							});

							// Call the streaming service with webview panel for live updates
							await callStreamingService(userInput, panel, outputChannel);

							// Clear the form for next request
							panel.webview.postMessage({ command: 'clearForm' });
						} else {
							panel.webview.postMessage({ command: 'showError', message: 'Type a valid request' });
						}
						break;
					case 'cancelRequest':
						// Call the stop-completion service
						try {
							await callStopService(outputChannel);
							panel.webview.postMessage({
								command: 'showCancelSuccess',
								content: '**Request cancelled.**',
								isMarkdown: true
							});
							outputChannel.appendLine('[INFO] User cancelled completion request');
						} catch (error) {
							outputChannel.appendLine(`[ERROR] Failed to cancel completion: ${error.message}`);
							outputChannel.show();
						}
						break;
					case 'resetConversation':
						// Call the reset memory service
						try {
							await callResetService(outputChannel);
							panel.webview.postMessage({
								command: 'resetResults',
								content: '**Conversation reset successfully.**\n\n*No results yet. Use the form below to submit a request.*',
								isMarkdown: true
							});
							outputChannel.appendLine('[INFO] User reset conversation memory');
						} catch (error) {
							outputChannel.appendLine(`[ERROR] Failed to reset conversation: ${error.message}`);
							outputChannel.show();
						}
						break;
					case 'toolOperation':
						// Handle tool operation (validate/cancel/reset)
						try {
							await callToolOperationService(message.action, message.operationId, panel, outputChannel);
							outputChannel.appendLine(`[INFO] Tool operation '${message.action}' executed for operation ${message.operationId}`);
						} catch (error) {
							outputChannel.appendLine(`[ERROR] Failed to execute tool operation: ${error.message}`);
							outputChannel.show();
							panel.webview.postMessage({
								command: 'appendResults',
								content: `\n\n**Error:** Failed to ${message.action} operation: ${error.message}`,
								isMarkdown: true
							});
						}
						break;
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable, streamingDisposable);
}

function getWebviewContent() {
	// Read the HTML content from external file
	const htmlPath = path.join(__dirname, 'extension.webview.html');
	const htmlContent = fs.readFileSync(htmlPath, 'utf8');
	return htmlContent;
}

async function callStreamingService(userContent, panel, outputChannel) {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
	const serviceUrl = `${baseUrl}/completion`;

	const data = JSON.stringify({
		data: {
			message: userContent
		}
	});

	let webviewContent = '';
	let firstChunkReceived = false;

	return new Promise((resolve, reject) => {
		const url = new URL(serviceUrl);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'text/event-stream',
				'Content-Length': Buffer.byteLength(data)
			}
		};

		const req = http.request(options, (res) => {
			if (res.statusCode !== 200) {
				// Stop progress animation on error
				panel.webview.postMessage({
					command: 'stopProgress'
				});
				const errorMsg = `**Error:** HTTP ${res.statusCode}`;
				panel.webview.postMessage({
					command: 'appendResults',
					content: errorMsg,
					isMarkdown: true
				});
				outputChannel.appendLine(`[ERROR] Streaming service HTTP error: ${res.statusCode}`);
				outputChannel.show();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}

			res.setEncoding('utf8');
			let buffer = '';

			res.on('data', (chunk) => {
				buffer += chunk;
				const lines = buffer.split('\n');
				buffer = lines.pop(); // Keep incomplete line in buffer

				lines.forEach(line => {
					if (line.startsWith('data: ')) {
						try {
							const jsonData = line.substring(6); // Remove 'data: ' prefix
							if (jsonData.trim() === '') return;

							const parsed = JSON.parse(jsonData);

							// Check for tool validation message
							if (parsed.kind === 'tool_call' && parsed.status === 'pending' && parsed.operation_id) {
								panel.webview.postMessage({
									command: 'showToolValidation',
									operationId: parsed.operation_id,
									message: parsed.message || 'Tool detected'
								});
								return;
							}

							if (parsed.message) {
								// Clean up the message (remove quotes and unescape)
								let content = parsed.message;
								if (typeof content === 'string') {
									// Remove surrounding quotes if present
									if (content.startsWith('"') && content.endsWith('"')) {
										content = content.slice(1, -1);
									}
									// Unescape quotes
									content = content.replace(/\\"/g, '"');

									// Check if this message contains a tool validation JSON (new format with kind)
									try {
										let toolData = JSON.parse(content);
										if (toolData.kind === 'tool_call' && toolData.status === 'pending' && toolData.operation_id) {
											panel.webview.postMessage({
												command: 'showToolValidation',
												operationId: toolData.operation_id,
												message: toolData.message || 'Tool detected'
											});
											return;
										}


										// const toolMatch = content.match(/\{"kind":\s*"tool_call",\s*"message":\s*"([^"]+)",\s*"status":\s*"pending",\s*"operation_id":\s*"([^"]+)"\}/);
										// if (toolMatch) {
										// 	const toolMessage = toolMatch[1];
										// 	const operationId = toolMatch[2];
										// 	panel.webview.postMessage({
										// 		command: 'showToolValidation',
										// 		operationId: operationId,
										// 		message: toolMessage
										// 	});
										// 	return;
										// }
									} catch (e) {
										// Not a tool validation message, continue
									}

									// Add to webview content and update
									// Keep animation running during streaming
									panel.webview.postMessage({
										command: 'appendResults',
										content: content,
										isMarkdown: true
									});
								}
							}
						} catch {
							// Ignore JSON parse errors for non-JSON lines
						}
					}
				});
			});

			res.on('end', async () => {
				// Stop progress animation when stream is complete
				panel.webview.postMessage({
					command: 'stopProgress'
				});

				try {
					// Fetch memory statistics
					const memoryUrl = `${baseUrl}/memory/messages/context-size`;
					const memoryResponse = await fetch(memoryUrl);
					const memoryData = await memoryResponse.json();

					/*
						type ContextSizeResponse struct {
							MessagesCount   int `json:"messages_count"`
							CharactersCount int `json:"characters_count"`
							Limit           int `json:"limit"`
						}

					*/

					// Fetch models information
					const modelsUrl = `${baseUrl}/models`;
					const modelsResponse = await fetch(modelsUrl);
					const modelsData = await modelsResponse.json();

					const completionMsg = `\n\n**--- Stream completed ---**\n\n**Messages:** ${memoryData.messages_count} | **Context Size:** ${memoryData.characters_count} | **Limit:** ${memoryData.limit}\n\n**Chat Model:** ${modelsData.chat_model}\n\n**Embeddings Model:** ${modelsData.embeddings_model}\n\n**Tools Model:** ${modelsData.tools_model}`;
					panel.webview.postMessage({
						command: 'appendResults',
						content: completionMsg,
						isMarkdown: true
					});
				} catch (error) {
					// Fallback if memory endpoint fails
					const completionMsg = '\n\n**--- Stream completed ---**';
					panel.webview.postMessage({
						command: 'appendResults',
						content: completionMsg,
						isMarkdown: true
					});
					outputChannel.appendLine(`[WARNING] Failed to fetch memory stats: ${error.message}`);
				}

				resolve();
			});

			res.on('error', (error) => {
				// Stop progress animation on error
				panel.webview.postMessage({
					command: 'stopProgress'
				});
				const errorMsg = `\n**Error:** ${error.message}`;
				panel.webview.postMessage({
					command: 'appendResults',
					content: errorMsg,
					isMarkdown: true
				});
				outputChannel.appendLine(`[ERROR] Streaming service response error: ${error.message}`);
				outputChannel.show();
				reject(error);
			});
		});

		req.on('error', (error) => {
			// Stop progress animation on error
			panel.webview.postMessage({
				command: 'stopProgress'
			});
			const errorMsg = `\n**Request Error:** ${error.message}`;
			panel.webview.postMessage({
				command: 'appendResults',
				content: errorMsg,
				isMarkdown: true
			});
			outputChannel.appendLine(`[ERROR] Streaming service request error: ${error.message}`);
			outputChannel.show();
			reject(error);
		});

		req.write(data);
		req.end();
	});
}

async function callToolOperationService(action, operationId, panel, outputChannel) {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
	const serviceUrl = `${baseUrl}/operation/${action}`;

	const data = JSON.stringify({
		operation_id: operationId
	});

	return new Promise((resolve, reject) => {
		const url = new URL(serviceUrl);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'text/event-stream',
				'Content-Length': Buffer.byteLength(data)
			}
		};

		const req = http.request(options, (res) => {
			if (res.statusCode !== 200) {
				panel.webview.postMessage({
					command: 'stopProgress'
				});
				const errorMsg = `**Error:** HTTP ${res.statusCode}`;
				panel.webview.postMessage({
					command: 'appendResults',
					content: errorMsg,
					isMarkdown: true
				});
				outputChannel.appendLine(`[ERROR] Tool operation service HTTP error: ${res.statusCode}`);
				outputChannel.show();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}

			res.setEncoding('utf8');
			let buffer = '';

			res.on('data', (chunk) => {
				buffer += chunk;
				const lines = buffer.split('\n');
				buffer = lines.pop();

				lines.forEach(line => {
					if (line.startsWith('data: ')) {
						try {
							const jsonData = line.substring(6);
							if (jsonData.trim() === '') return;

							const parsed = JSON.parse(jsonData);

							// Check for another tool validation message
							if (parsed.kind === 'tool_call' && parsed.status === 'pending' && parsed.operation_id) {
								panel.webview.postMessage({
									command: 'showToolValidation',
									operationId: parsed.operation_id,
									message: parsed.message || 'Tool detected'
								});
								return;
							}

							if (parsed.message) {
								let content = parsed.message;
								if (typeof content === 'string') {
									if (content.startsWith('"') && content.endsWith('"')) {
										content = content.slice(1, -1);
									}
									content = content.replace(/\\"/g, '"');

									panel.webview.postMessage({
										command: 'appendResults',
										content: content,
										isMarkdown: true
									});
								}
							}
						} catch {
							// Ignore JSON parse errors
						}
					}
				});
			});

			res.on('end', () => {
				panel.webview.postMessage({
					command: 'stopProgress'
				});
				resolve();
			});

			res.on('error', (error) => {
				panel.webview.postMessage({
					command: 'stopProgress'
				});
				const errorMsg = `\n**Error:** ${error.message}`;
				panel.webview.postMessage({
					command: 'appendResults',
					content: errorMsg,
					isMarkdown: true
				});
				outputChannel.appendLine(`[ERROR] Tool operation service response error: ${error.message}`);
				outputChannel.show();
				reject(error);
			});
		});

		req.on('error', (error) => {
			panel.webview.postMessage({
				command: 'stopProgress'
			});
			const errorMsg = `\n**Request Error:** ${error.message}`;
			panel.webview.postMessage({
				command: 'appendResults',
				content: errorMsg,
				isMarkdown: true
			});
			outputChannel.appendLine(`[ERROR] Tool operation service request error: ${error.message}`);
			outputChannel.show();
			reject(error);
		});

		req.write(data);
		req.end();
	});
}

async function checkServiceHealth(outputChannel) {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
	const healthUrl = `${baseUrl}/health`;

	return new Promise((resolve, reject) => {
		const url = new URL(healthUrl);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			},
			timeout: 5000 // 5 second timeout
		};

		const req = http.request(options, (res) => {
			if (res.statusCode !== 200) {
				outputChannel.appendLine(`[ERROR] Service health check failed: HTTP ${res.statusCode}`);
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}

			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				try {
					const response = JSON.parse(data);
					if (response.status === 'ok') {
						outputChannel.appendLine('[INFO] Service health check passed');
						resolve(true);
					} else {
						outputChannel.appendLine(`[ERROR] Service health check failed: status = ${response.status}`);
						reject(new Error(`Invalid status: ${response.status}`));
					}
				} catch (error) {
					outputChannel.appendLine(`[ERROR] Service health check failed: Invalid JSON response`);
					reject(new Error('Invalid JSON response'));
				}
			});
		});

		req.on('timeout', () => {
			req.destroy();
			outputChannel.appendLine('[ERROR] Service health check timeout');
			reject(new Error('Request timeout'));
		});

		req.on('error', (error) => {
			outputChannel.appendLine(`[ERROR] Service health check failed: ${error.message}`);
			reject(error);
		});

		req.end();
	});
}

async function callStopService(outputChannel) {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
	const serviceUrl = `${baseUrl}/completion/stop`;

	return new Promise((resolve, reject) => {
		const url = new URL(serviceUrl);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			}
		};

		const req = http.request(options, (res) => {
			if (res.statusCode !== 200) {
				console.log(`Stop service error: HTTP ${res.statusCode}`);
				outputChannel.appendLine(`[ERROR] Stop service HTTP error: ${res.statusCode}`);
				outputChannel.show();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}

			console.log('Stop completion service called successfully');
			outputChannel.appendLine('[INFO] Stop completion service called successfully');
			resolve();
		});

		req.on('error', (error) => {
			console.log(`Stop service request error: ${error.message}`);
			outputChannel.appendLine(`[ERROR] Stop service request error: ${error.message}`);
			outputChannel.show();
			reject(error);
		});

		req.end();
	});
}

async function callResetService(outputChannel) {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);
	const baseUrl = config.get('serviceBaseUrl', SERVICE_BASE_URL_CONFIG);
	const serviceUrl = `${baseUrl}/memory/reset`;

	return new Promise((resolve, reject) => {
		const url = new URL(serviceUrl);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			}
		};

		const req = http.request(options, (res) => {
			if (res.statusCode !== 200) {
				console.log(`Reset service error: HTTP ${res.statusCode}`);
				outputChannel.appendLine(`[ERROR] Reset service HTTP error: ${res.statusCode}`);
				outputChannel.show();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}

			console.log('Reset conversation service called successfully');
			outputChannel.appendLine('[INFO] Reset conversation service called successfully');
			resolve();
		});

		req.on('error', (error) => {
			console.log(`Reset service request error: ${error.message}`);
			outputChannel.appendLine(`[ERROR] Reset service request error: ${error.message}`);
			outputChannel.show();
			reject(error);
		});

		req.end();
	});
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
