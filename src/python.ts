import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { getEnvVars } from './config';

const exec = promisify(cp.exec);

export interface ExecutePythonScriptOptions {
    showNotifications?: boolean;
    showErrorModal?: boolean;   
    successMessage?: string;    
    customErrorHandler?: (error: Error, defaultMessage: string) => void; // 新增自定义错误处理回调
}

/**
 * Executes a Python script with given arguments and options for notifications.
 * @param workspacePath The workspace path.
 * @param pythonExecutable Path to the Python executable.
 * @param scriptPath Path to the Python script.
 *   Note: This should be an absolute path or a path resolvable from workspacePath,
 *   as executePythonScript will make it absolute if it's not.
 * @param args Arguments to pass to the script.
 * @param options Options to control notification behavior.
 * @returns A promise that resolves with stdout and stderr, or rejects on error.
 */
export async function executePythonScript(
    workspacePath: string,
    pythonExecutable: string,
    scriptPath: string, // 确保传入的是期望的路径 (相对或绝对)
    args: string[] = [],
    options: ExecutePythonScriptOptions = {}
): Promise<{ stdout: string; stderr: string }> { // 总是返回对象或抛出错误
    
    const notify = options.showNotifications ?? true; 
    const errorModal = options.showErrorModal ?? false; 
    
    const absoluteScriptPath = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(workspacePath, scriptPath);

    const env: { [key: string]: string | undefined } = { ...process.env, PYTHONIOENCODING: 'UTF-8' };
    getEnvVars(workspacePath).forEach((value, key) => {
        env[key] = value;
    });

    const commandParts = [
        `"${pythonExecutable}"`,
        `"${absoluteScriptPath}"`, // 使用绝对路径
        ...args.map(arg => `"${arg.replace(/"/g, '\\"')}"`)
    ];
    const command = commandParts.join(' ');
    
    console.log(`[Python] Executing: ${command} (in ${workspacePath})`);

    try {
        const { stdout, stderr } = await exec(command, { env, cwd: workspacePath });
        
        const successLog = `[Python] Script executed successfully: ${absoluteScriptPath}. Args: ${args.join(' ')}.\nStdout: ${stdout || '<No Output>'}\nStderr: ${stderr || '<No Stderr>'}`;
        console.log(successLog);

        if (notify) {
            const defaultSuccessMessage = `Script executed successfully!\n\nScript: ${path.basename(absoluteScriptPath)}\nArgs: ${args.join(' ')}`;
            let message = options.successMessage || defaultSuccessMessage;
            if (stdout && stdout.trim()) message += `\n\nOutput:\n${stdout.trim()}`;
            // stderr 并不总是错误，有些脚本用它输出进度或调试信息
            if (stderr && stderr.trim()) message += `\n\nStandard Error Output (may not be an error):\n${stderr.trim()}`;
            vscode.window.showInformationMessage(message, { modal: false });
        }
        return { stdout, stderr };

    } catch (err) {
        const error = err as cp.ExecException & { stdout?: string; stderr?: string };
        let defaultErrorMessage = `Script execution failed! (Exit Code: ${error.code || 'unknown'})\nScript: ${path.basename(absoluteScriptPath)}\nArgs: ${args.join(' ')}\n\n`;
        if (error.stdout && error.stdout.trim()) defaultErrorMessage += `Standard Output:\n${error.stdout.trim()}\n\n`;
        if (error.stderr && error.stderr.trim()) defaultErrorMessage += `Standard Error:\n${error.stderr.trim() || '<No Error Output>'}`;
        else if (!error.stderr && !error.stdout) defaultErrorMessage += "No output from script before error.";

        console.error(`[Python] Command failed: ${command}\nError: ${error.message}\nStdout: ${error.stdout || ''}\nStderr: ${error.stderr || ''}`);

        if (options.customErrorHandler) {
            options.customErrorHandler(error, defaultErrorMessage);
        } else if (notify) {
            vscode.window.showErrorMessage(defaultErrorMessage, { modal: errorModal });
        }
        // 即使有自定义错误处理或通知，也应抛出错误，以便调用者可以进一步处理
        throw new Error(defaultErrorMessage); 
    }
}