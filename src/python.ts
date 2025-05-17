import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';
import { getEnvVars } from './config';

const exec = promisify(cp.exec);

export async function executePythonScript(workspacePath: string, pythonExecutable: string, scriptPath: string): Promise<void> {
    const env: { [key: string]: string | undefined } = { ...process.env, PYTHONIOENCODING: 'UTF-8' };
    getEnvVars(workspacePath).forEach((value, key) => {
        env[key] = value;
    });

    try {
        const { stdout, stderr } = await exec(`"${pythonExecutable}" "${scriptPath}"`, { env, cwd: workspacePath });
        let message = `Script executed successfully!\n\nOutput:\n${stdout || '<No Output>'}`;
        if (stderr) message += `\n\nStandard Error:\n${stderr}`;
        vscode.window.showInformationMessage(message, { modal: true });
    } catch (err) {
        const error = err as cp.ExecException;
        let message = `Script execution failed! (Exit Code: ${error.code || 'unknown'})\n\n`;
        if (error.stdout) message += `Standard Output:\n${error.stdout}\n\n`;
        if (error.stderr) message += `Standard Error:\n${error.stderr || '<No Error Output>'}`;
        throw new Error(message);
    }
}