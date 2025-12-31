// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const http = require('http');
const { marked } = require('marked');
const hljs = require('highlight.js');

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
	return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${EXTENSION_ID}</title>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/vs2015.min.css">
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 0;
			margin: 0;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			height: 100vh;
			display: flex;
			flex-direction: column;
		}
		.container {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
		.results-container {
			flex: 1;
			padding: 20px;
			overflow-y: auto;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.form-container {
			padding: 20px;
			background-color: var(--vscode-editor-background);
			border-top: 1px solid var(--vscode-panel-border);
		}
		h1 {
			color: var(--vscode-foreground);
			margin: 0 0 20px 0;
			font-size: 18px;
		}
		.results-header {
			margin: 0 0 15px 0;
			font-size: 16px;
			font-weight: bold;
		}
		.results-content {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-textCodeBlock-background);
			padding: 15px;
			border-radius: 4px;
			border: 1px solid var(--vscode-panel-border);
			min-height: 100px;
			display: block;
			overflow-x: hidden;
		}
		.results-content pre {
			background-color: var(--vscode-textPreformat-background);
			padding: 10px;
			border-radius: 4px;
			overflow-x: auto;
		}
		.results-content code {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
		}
		.code-block-container {
			position: relative;
		}
		.copy-button {
			position: absolute;
			top: 8px;
			right: 8px;
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none;
			padding: 4px 8px;
			border-radius: 3px;
			cursor: pointer;
			font-size: 11px;
			opacity: 0.7;
			transition: opacity 0.2s;
		}
		.copy-button:hover {
			opacity: 1;
			background-color: var(--vscode-button-secondaryHoverBackground);
		}
		.copy-button.copied {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.results-content h1, .results-content h2, .results-content h3, .results-content h4, .results-content h5, .results-content h6 {
			color: var(--vscode-foreground);
		}
		.results-content blockquote {
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			background-color: var(--vscode-textBlockQuote-background);
			padding: 10px 15px;
			margin: 10px 0;
		}
		label {
			display: block;
			margin-bottom: 8px;
			font-weight: bold;
		}
		textarea {
			width: 100%;
			height: 80px;
			padding: 10px;
			border: 1px solid var(--vscode-input-border);
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 4px;
			resize: vertical;
			font-family: inherit;
			box-sizing: border-box;
		}
		textarea:focus {
			outline: none;
			border-color: var(--vscode-focusBorder);
		}
		.button-container {
			margin-top: 15px;
			display: flex;
			justify-content: flex-end;
			gap: 10px;
		}
		button {
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 14px;
			font-family: inherit;
		}
		.ok-button {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.ok-button:hover {
			background-color: var(--vscode-button-hoverBackground);
		}
		.cancel-button {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.cancel-button:hover {
			background-color: var(--vscode-button-secondaryHoverBackground);
		}
		button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.error-message {
			color: var(--vscode-errorForeground);
			margin-top: 10px;
			display: none;
		}
		.success-message {
			color: var(--vscode-terminal-ansiGreen);
			margin-top: 10px;
			display: none;
		}
		.progress-message {
			color: var(--vscode-terminal-ansiCyan);
			margin-top: 10px;
			display: none;
			font-style: italic;
		}
		.placeholder-text {
			color: var(--vscode-input-placeholderForeground);
			font-size: 12px;
			margin-top: 5px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="results-container">
			<div class="results-header">Results:</div>
			<div class="results-content" id="resultsContent">

			</div>
		</div>
		<div class="form-container">
			<!--
			<h1>Request</h1>
			-->
			<form>
				<label for="requestInput">Request:</label>
				<textarea
					id="requestInput"
					placeholder="Exemple : Who are you?"
					required
				></textarea>
				<div class="placeholder-text">
					Describe your request in detail to get the best possible response.
				</div>
				<div class="error-message" id="errorMessage"></div>
				<div class="progress-message" id="progressMessage"></div>
				<div class="success-message" id="successMessage">✓ Request sent successfully!</div>
				<div class="button-container">
					<button type="button" id="copyResultButton" class="cancel-button">Copy Result</button>
					<button type="button" id="resetButton" class="cancel-button">Reset Conversation</button>
					<button type="button" id="cancelButton" class="cancel-button">Cancel</button>
					<button type="submit" id="submitButton" class="ok-button">OK</button>
				</div>
			</form>
		</div>
	</div>

	<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
	<script>
		const vscode = acquireVsCodeApi();

		// Configure marked with highlight.js
		if (typeof marked !== 'undefined') {
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
		}

		// Variable to store raw content for copying
		let currentRawContent = '';

		// Variable to track if we should reset results or append
		let shouldResetResults = true;

		// Variables for progress animation
		let progressInterval = null;
		let progressMessageIndex = 0;
		const progressMessages = [
			'🤔 Thinking...',
			'💭 Processing your request...',
			'🔍 Analyzing context...',
			'✨ Generating response...',
			'🧠 Considering options...',
			'📝 Composing answer...',
			'🎯 Refining thoughts...',
			'⚡ Working on it...'
		];

		// Initialize with markdown content
		showResults('*No results yet. Use the form below to submit a request.*', true, true);

		document.getElementById('requestInput').focus();

		document.querySelector('form').addEventListener('submit', (e) => {
			e.preventDefault();
			const input = document.getElementById('requestInput');
			const text = input.value.trim();

			if (text.length === 0) {
				showError('Please enter a valid request');
				return;
			}

			// Send message to extension (animation will be started by backend)
			vscode.postMessage({
				command: 'submitRequest',
				text: text
			});
		});

		// Handle Copy Result button
		document.getElementById('copyResultButton').addEventListener('click', (e) => {
			e.preventDefault();
			// Copy the raw markdown content instead of the rendered text
			navigator.clipboard.writeText(currentRawContent || '').then(() => {
				// Show success message briefly
				const button = e.target;
				const originalText = button.textContent;
				button.textContent = 'Copied!';
				button.style.backgroundColor = 'var(--vscode-button-background)';
				button.style.color = 'var(--vscode-button-foreground)';

				setTimeout(() => {
					button.textContent = originalText;
					button.style.backgroundColor = '';
					button.style.color = '';
				}, 2000);
			}).catch(err => {
				console.error('Failed to copy text: ', err);
				const button = e.target;
				const originalText = button.textContent;
				button.textContent = 'Copy Failed';
				setTimeout(() => {
					button.textContent = originalText;
				}, 2000);
			});
		});

		// Handle Reset Conversation button
		document.getElementById('resetButton').addEventListener('click', (e) => {
			e.preventDefault();
			shouldResetResults = true;
			vscode.postMessage({
				command: 'resetConversation'
			});
		});

		// Handle Cancel button
		document.getElementById('cancelButton').addEventListener('click', (e) => {
			e.preventDefault();
			vscode.postMessage({
				command: 'cancelRequest'
			});
		});

		// Handle Enter key (Ctrl+Enter to submit)
		document.getElementById('requestInput').addEventListener('keydown', (e) => {
			if (e.ctrlKey && e.key === 'Enter') {
				document.querySelector('form').dispatchEvent(new Event('submit'));
			}
		});

		// Listen for messages from the extension
		window.addEventListener('message', event => {
			const message = event.data;
			switch (message.command) {
				case 'showError':
					stopProgressAnimation();
					showError(message.message);
					break;
				case 'clearForm':
					stopProgressAnimation();
					clearForm();
					break;
				case 'startProgress':
					// Start progress animation (sent from extension)
					startProgressAnimation();
					break;
				case 'stopProgress':
					// Stop progress animation (sent from extension when first content arrives)
					stopProgressAnimation();
					break;
				case 'appendResults':
					// Append new content to existing results
					showResults(message.content, true, message.isMarkdown);
					break;
				case 'resetResults':
					stopProgressAnimation();
					// Reset the conversation history
					shouldResetResults = true;
					showResults(message.content, true, message.isMarkdown);
					break;
				case 'showCancelSuccess':
					stopProgressAnimation();
					showResults(message.content, true, message.isMarkdown);
					break;
				case 'showToolValidation':
					stopProgressAnimation();
					showToolValidationButtons(message.operationId, message.message);
					break;
			}
		});

		function showError(message) {
			const errorElement = document.getElementById('errorMessage');
			errorElement.textContent = message;
			errorElement.style.display = 'block';
			setTimeout(() => {
				errorElement.style.display = 'none';
			}, 5000);
		}

		function startProgressAnimation() {
			const progressElement = document.getElementById('progressMessage');
			progressMessageIndex = 0;
			progressElement.textContent = progressMessages[progressMessageIndex];
			progressElement.style.display = 'block';

			// Change message every 2 seconds
			progressInterval = setInterval(() => {
				progressMessageIndex = (progressMessageIndex + 1) % progressMessages.length;
				progressElement.textContent = progressMessages[progressMessageIndex];
			}, 2000);
		}

		function stopProgressAnimation() {
			if (progressInterval) {
				clearInterval(progressInterval);
				progressInterval = null;
			}
			const progressElement = document.getElementById('progressMessage');
			progressElement.style.display = 'none';
		}

		function showResults(content, isComplete, isMarkdown = false) {
			const resultsElement = document.getElementById('resultsContent');
			const resultsContainer = document.querySelector('.results-container');

			// If shouldResetResults is true, replace content. Otherwise append
			if (shouldResetResults) {
				currentRawContent = content;
				shouldResetResults = false;
			} else {
				// Append new content to existing raw content
				currentRawContent += content;
			}

			if (isMarkdown && typeof marked !== 'undefined') {
				// Render markdown with syntax highlighting
				resultsElement.innerHTML = marked.parse(currentRawContent);
				// Apply syntax highlighting to code blocks
				if (typeof hljs !== 'undefined') {
					resultsElement.querySelectorAll('pre code').forEach((block) => {
						hljs.highlightElement(block);
					});
				}
				// Add copy buttons to code blocks
				addCopyButtonsToCodeBlocks();
			} else {
				// Fallback to plain text
				resultsElement.textContent = currentRawContent;
			}

			// Auto-scroll to bottom during stream - force scroll after all DOM updates
			scrollToBottom();
		}

		function scrollToBottom() {
			const resultsContainer = document.querySelector('.results-container');
			if (resultsContainer) {
				// Force immediate scroll
				resultsContainer.scrollTop = resultsContainer.scrollHeight;
				// Also schedule another scroll after next paint
				requestAnimationFrame(() => {
					resultsContainer.scrollTop = resultsContainer.scrollHeight;
					// And one more after layout
					setTimeout(() => {
						resultsContainer.scrollTop = resultsContainer.scrollHeight;
					}, 100);
				});
			}
		}

		function addCopyButtonsToCodeBlocks() {
			const codeBlocks = document.querySelectorAll('pre:has(code)');
			codeBlocks.forEach((pre) => {
				// Skip if already has a copy button
				if (pre.querySelector('.copy-button')) return;

				// Wrap pre in container if not already wrapped
				if (!pre.parentElement.classList.contains('code-block-container')) {
					const container = document.createElement('div');
					container.className = 'code-block-container';
					pre.parentNode.insertBefore(container, pre);
					container.appendChild(pre);
				}

				// Create copy button
				const copyButton = document.createElement('button');
				copyButton.className = 'copy-button';
				copyButton.textContent = 'Copy';
				copyButton.onclick = function() {
					const code = pre.querySelector('code');
					if (code) {
						navigator.clipboard.writeText(code.textContent).then(() => {
							copyButton.textContent = 'Copied!';
							copyButton.classList.add('copied');
							setTimeout(() => {
								copyButton.textContent = 'Copy';
								copyButton.classList.remove('copied');
							}, 2000);
						}).catch(err => {
							console.error('Failed to copy text: ', err);
							copyButton.textContent = 'Error';
							setTimeout(() => {
								copyButton.textContent = 'Copy';
							}, 2000);
						});
					}
				};

				pre.parentElement.appendChild(copyButton);
			});
		}

		function showToolValidationButtons(operationId, message) {
			console.log('showToolValidationButtons called', operationId, message);

			// Create a unique container ID for this operation
			const containerId = 'tool-validation-' + operationId.replace(/[^a-zA-Z0-9]/g, '_');

			// Add HTML content directly
			const htmlContent = \`
<div style="background-color: var(--vscode-editor-inactiveSelectionBackground); padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid var(--vscode-editorWarning-foreground);">
	<p style="margin: 0 0 10px 0;"><strong>⚠️ \${message}</strong></p>
	<p style="margin: 0 0 10px 0; font-size: 0.9em; opacity: 0.8;">Operation ID: <code>\${operationId}</code></p>
	<div id="\${containerId}" style="display: flex; gap: 10px; flex-wrap: wrap;">
		<button onclick="handleToolOperation('validate', '\${operationId}', '\${containerId}')" style="background-color: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600;">
			✅ Validate
		</button>
		<button onclick="handleToolOperation('cancel', '\${operationId}', '\${containerId}')" style="background-color: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600;">
			⛔️ Cancel
		</button>
		<button onclick="handleToolOperation('reset', '\${operationId}', '\${containerId}')" style="background-color: #ffc107; color: #212529; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600;">
			🔄 Reset
		</button>
	</div>
</div>
\`;

			// Append the HTML content to the results
			const resultsElement = document.getElementById('resultsContent');
			resultsElement.insertAdjacentHTML('beforeend', htmlContent);

			scrollToBottom();
		}

		function handleToolOperation(action, operationId, containerId) {
			console.log('handleToolOperation called', action, operationId, containerId);

			// Disable all buttons in ALL tool validation containers
			const allContainers = document.querySelectorAll('[id^="tool-validation-"]');
			allContainers.forEach(container => {
				const buttons = container.querySelectorAll('button');
				buttons.forEach(btn => {
					btn.disabled = true;
					btn.style.opacity = '0.5';
					btn.style.cursor = 'not-allowed';
				});
			});

			// Send message to extension
			vscode.postMessage({
				command: 'toolOperation',
				action: action,
				operationId: operationId
			});

			// Show loading message
			const resultsElement = document.getElementById('resultsContent');
			resultsElement.insertAdjacentHTML('beforeend', '<p style="font-style: italic; color: var(--vscode-terminal-ansiCyan);">Processing ' + action + ' operation...</p>');
			scrollToBottom();
		}

		function clearForm() {
			const input = document.getElementById('requestInput');
			input.value = '';
			input.focus();

			// Hide any error messages
			const errorElement = document.getElementById('errorMessage');
			errorElement.style.display = 'none';

			// Show success message briefly
			const successElement = document.getElementById('successMessage');
			if (successElement) {
				successElement.style.display = 'block';
				setTimeout(() => {
					successElement.style.display = 'none';
				}, 3000);
			}
		}
	</script>
</body>
</html>`;
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
					const memoryUrl = `${baseUrl}/memory/messages/tokens`;
					const memoryResponse = await fetch(memoryUrl);
					const memoryData = await memoryResponse.json();

					// Fetch models information
					const modelsUrl = `${baseUrl}/models`;
					const modelsResponse = await fetch(modelsUrl);
					const modelsData = await modelsResponse.json();

					const completionMsg = `\n\n**--- Stream completed ---**\n\n**Messages:** ${memoryData.count} | **Token Count Estimate:** ${memoryData.tokens} | **Limit:** ${memoryData.limit}\n\n**Chat Model:** ${modelsData.chat_model}\n\n**Embeddings Model:** ${modelsData.embeddings_model}\n\n**Tools Model:** ${modelsData.tools_model}`;
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
