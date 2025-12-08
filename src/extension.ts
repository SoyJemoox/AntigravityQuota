/**
 * Antigravity Quota Watcher - Main Entry
 */

import * as vscode from 'vscode';
import {ConfigManager} from './core/config_manager';
import {ProcessFinder} from './core/process_finder';
import {QuotaManager} from './core/quota_manager';
import {StatusBarManager} from './ui/status_bar';

let config_manager: ConfigManager;
let process_finder: ProcessFinder;
let quota_manager: QuotaManager;
let status_bar: StatusBarManager;
let is_initialized = false;

export async function activate(context: vscode.ExtensionContext) {
	console.log('AG Quota Watcher 2.0 Activated');

	config_manager = new ConfigManager();
	process_finder = new ProcessFinder();
	quota_manager = new QuotaManager();
	status_bar = new StatusBarManager();

	context.subscriptions.push(status_bar);

	const config = config_manager.get_config();

	// Register Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('agq.refresh', () => {
			vscode.window.showInformationMessage('Refreshing Quota...');
			quota_manager.fetch_quota();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('agq.show_menu', () => {
			status_bar.show_menu();
		})
	);

	// Manual activation command
	context.subscriptions.push(
		vscode.commands.registerCommand('agq.activate', async () => {
			if (!is_initialized) {
				await initialize_extension();
			} else {
				vscode.window.showInformationMessage('AGQ is already active');
			}
		})
	);

	// Setup Quota Manager Callbacks
	quota_manager.on_update(snapshot => {
		const current_config = config_manager.get_config();
		status_bar.update(snapshot, current_config.show_prompt_credits ?? false);
	});

	quota_manager.on_error(err => {
		status_bar.show_error(err.message);
	});

	// Initialize extension asynchronously (non-blocking)
	// This prevents blocking VS Code startup
	initialize_extension().catch(err => {
		console.error('Failed to initialize AG Quota Watcher:', err);
	});

	// Handle Config Changes
	context.subscriptions.push(
		config_manager.on_config_change(new_config => {
			if (new_config.enabled) {
				quota_manager.start_polling(new_config.polling_interval);
			} else {
				quota_manager.stop_polling();
			}
		})
	);
}

async function initialize_extension() {
	if (is_initialized) return;

	const config = config_manager.get_config();
	status_bar.show_loading();

	try {
		const process_info = await process_finder.detect_process_info();

		if (process_info) {
			console.log('Process found:', process_info);
			quota_manager.init(process_info.connect_port, process_info.csrf_token);

			if (config.enabled) {
				quota_manager.start_polling(config.polling_interval);
			}
			is_initialized = true;
		} else {
			status_bar.show_error('Antigravity process not found');
			vscode.window.showErrorMessage('Could not find Antigravity process. Is it running?');
		}
	} catch (e: any) {
		status_bar.show_error('Detection failed');
		console.error(e);
	}
}

export function deactivate() {
	quota_manager?.stop_polling();
	status_bar?.dispose();
}
