import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';
import { getEnvVars } from './config';

const exec = promisify(cp.exec);

// Modified to accept an array of arguments
export async function executePythonScript(
    workspacePath: string,
    pythonExecutable: string,
    scriptPath: string,
    args: string[] = [] // New parameter for arguments
): Promise<void> {
    const env: { [key: string]: string | undefined } = { ...process.env, PYTHONIOENCODING: 'UTF-8' };
    getEnvVars(workspacePath).forEach((value, key) => {
        env[key] = value;
    });

    // Construct the command with arguments, ensuring paths and arguments are quoted
    const commandParts = [
        `"${pythonExecutable}"`,
        `"${scriptPath}"`,
        ...args.map(arg => `"${arg.replace(/"/g, '\\"')}"`) // Quote each argument and escape internal quotes
    ];
    const command = commandParts.join(' ');
    
    vscode.window.showInformationMessage(`Executing: ${command}`); // For debugging

    try {
        const { stdout, stderr } = await exec(command, { env, cwd: workspacePath });
        let message = `Script executed successfully!\n\nScript: ${scriptPath}\nArgs: ${args.join(' ')}\n\nOutput:\n${stdout || '<No Output>'}`;
        if (stderr) message += `\n\nStandard Error:\n${stderr}`;
        vscode.window.showInformationMessage(message, { modal: true });
    } catch (err) {
        const error = err as cp.ExecException & { stdout?: string; stderr?: string }; // Make sure stdout/stderr are optional
        let message = `Script execution failed! (Exit Code: ${error.code || 'unknown'})\nScript: ${scriptPath}\nArgs: ${args.join(' ')}\n\n`;
        if (error.stdout) message += `Standard Output:\n${error.stdout}\n\n`;
        if (error.stderr) message += `Standard Error:\n${error.stderr || '<No Error Output>'}`;
        // Log the full command for easier debugging
        console.error(`Failed command: ${command}`, error);
        throw new Error(message);
    }
}