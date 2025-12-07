/**
 * Process Finder Service
 */

import {exec} from 'child_process';
import {promisify} from 'util';
import * as https from 'https';
import {WindowsStrategy, UnixStrategy, platform_strategy} from './platform_strategies';
import * as process from 'process';
import * as vscode from 'vscode';

const exec_async = promisify(exec);

export interface process_info {
	extension_port: number;
	connect_port: number;
	csrf_token: string;
}

export class ProcessFinder {
	private strategy: platform_strategy;
	private process_name: string;

	constructor() {
		if (process.platform === 'win32') {
			this.strategy = new WindowsStrategy();
			this.process_name = 'language_server_windows_x64.exe';
		} else if (process.platform === 'darwin') {
			this.strategy = new UnixStrategy('darwin');
			this.process_name = `language_server_macos${process.arch === 'arm64' ? '_arm' : ''}`;
		} else {
			this.strategy = new UnixStrategy('linux');
			this.process_name = `language_server_linux${process.arch === 'arm64' ? '_arm' : '_x64'}`;
		}
	}

	async detect_process_info(max_retries: number = 1): Promise<process_info | null> {
		for (let i = 0; i < max_retries; i++) {
			try {
				const cmd = this.strategy.get_process_list_command(this.process_name);
				const {stdout} = await exec_async(cmd, {timeout: 2000});

				const info = this.strategy.parse_process_info(stdout);
				if (info) {
					const ports = await this.get_listening_ports(info.pid);
					if (ports.length > 0) {
						const valid_port = await this.find_working_port(ports, info.csrf_token);
						if (valid_port) {
							return {
								extension_port: info.extension_port,
								connect_port: valid_port,
								csrf_token: info.csrf_token,
							};
						}
					}
				}
			} catch (e) {
				console.error(`Attempt ${i + 1} failed:`, e);
			}
			if (i < max_retries - 1) {
				await new Promise(r => setTimeout(r, 100));
			}
		}
		return null;
	}

	private async get_listening_ports(pid: number): Promise<number[]> {
		try {
			const cmd = this.strategy.get_port_list_command(pid);
			const {stdout} = await exec_async(cmd);
			return this.strategy.parse_listening_ports(stdout);
		} catch {
			return [];
		}
	}

	private async find_working_port(ports: number[], csrf_token: string): Promise<number | null> {
		for (const port of ports) {
			if (await this.test_port(port, csrf_token)) {
				return port;
			}
		}
		return null;
	}

	private test_port(port: number, csrf_token: string): Promise<boolean> {
		return new Promise(resolve => {
			const options = {
				hostname: '127.0.0.1',
				port,
				path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Codeium-Csrf-Token': csrf_token,
					'Connect-Protocol-Version': '1',
				},
				rejectUnauthorized: false,
				timeout: 500,
			};

			const req = https.request(options, res => {
				resolve(res.statusCode === 200);
			});
			req.on('error', () => resolve(false));
			req.on('timeout', () => {
				req.destroy();
				resolve(false);
			});
			req.write(JSON.stringify({wrapper_data: {}}));
			req.end();
		});
	}
}
