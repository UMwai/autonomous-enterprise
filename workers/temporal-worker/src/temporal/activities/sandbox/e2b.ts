/**
 * E2B Sandbox integration for secure code execution.
 */

import { Sandbox } from '@e2b/code-interpreter';
import { Context } from '@temporalio/activity';
import pino from 'pino';

const logger = pino();

/**
 * Sandbox session handle.
 */
export interface SandboxSession {
  id: string;
  sandbox: Sandbox;
  createdAt: Date;
}

/**
 * Result of command execution in sandbox.
 */
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  error?: string;
}

/**
 * File upload configuration.
 */
export interface FileUpload {
  path: string;
  content: string | Buffer;
}

/**
 * Downloaded file from sandbox.
 */
export interface DownloadedFile {
  path: string;
  content: Buffer;
}

/**
 * Resource limits for sandbox.
 */
export interface ResourceLimits {
  cpuCount?: number;
  memoryMB?: number;
  timeoutMs?: number;
  networkAllowlist?: string[];
}

/**
 * E2B Sandbox manager for secure code execution.
 */
export class E2BSandbox {
  private static readonly DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

  /**
   * Create a new sandbox session.
   *
   * @param template - E2B template to use (default: 'base')
   * @param _limits - Resource limits for the sandbox (currently unused)
   * @returns Sandbox session handle
   */
  static async create(
    template: string = 'base',
    _limits?: ResourceLimits
  ): Promise<SandboxSession> {
    logger.info({ template }, 'Creating E2B sandbox');

    try {
      const sandbox = await Sandbox.create(template);

      const session: SandboxSession = {
        id: sandbox.sandboxId,
        sandbox,
        createdAt: new Date(),
      };

      logger.info({ sessionId: session.id }, 'Sandbox created successfully');
      return session;

    } catch (error) {
      logger.error({ error, template }, 'Failed to create sandbox');
      throw new Error(`Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute a command in the sandbox.
   *
   * @param session - Sandbox session
   * @param command - Command to execute
   * @param timeout - Execution timeout in milliseconds
   * @returns Execution result
   */
  static async execute(
    session: SandboxSession,
    command: string,
    timeout: number = E2BSandbox.DEFAULT_TIMEOUT_MS
  ): Promise<ExecutionResult> {
    logger.info({ sessionId: session.id, command, timeout }, 'Executing command in sandbox');

    try {
      // Check for activity heartbeat/cancellation
      if (Context.current().info.isLocal === false) {
        Context.current().heartbeat();
      }

      const result = await session.sandbox.commands.run(command, {
        timeoutMs: timeout,
      });

      const executionResult: ExecutionResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: false, // E2B throws on timeout rather than setting a flag
      };

      logger.info(
        { sessionId: session.id, exitCode: result.exitCode, timedOut: executionResult.timedOut },
        'Command execution completed'
      );

      return executionResult;

    } catch (error) {
      logger.error({ error, sessionId: session.id, command }, 'Command execution failed');
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Upload files to the sandbox.
   *
   * @param session - Sandbox session
   * @param files - Files to upload
   */
  static async uploadFiles(
    session: SandboxSession,
    files: FileUpload[]
  ): Promise<void> {
    logger.info({ sessionId: session.id, fileCount: files.length }, 'Uploading files to sandbox');

    try {
      for (const file of files) {
        const content = typeof file.content === 'string'
          ? file.content
          : file.content.toString('utf-8');

        await session.sandbox.files.write(file.path, content);
        logger.debug({ sessionId: session.id, path: file.path }, 'File uploaded');
      }

      logger.info({ sessionId: session.id, fileCount: files.length }, 'All files uploaded successfully');

    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to upload files');
      throw new Error(`Failed to upload files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download files from the sandbox.
   *
   * @param session - Sandbox session
   * @param paths - File paths to download
   * @returns Downloaded files
   */
  static async downloadFiles(
    session: SandboxSession,
    paths: string[]
  ): Promise<DownloadedFile[]> {
    logger.info({ sessionId: session.id, paths }, 'Downloading files from sandbox');

    const downloadedFiles: DownloadedFile[] = [];

    try {
      for (const path of paths) {
        const content = await session.sandbox.files.read(path);
        downloadedFiles.push({
          path,
          content: Buffer.from(content),
        });
        logger.debug({ sessionId: session.id, path }, 'File downloaded');
      }

      logger.info(
        { sessionId: session.id, fileCount: downloadedFiles.length },
        'All files downloaded successfully'
      );

      return downloadedFiles;

    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to download files');
      throw new Error(`Failed to download files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List files in a directory.
   *
   * @param session - Sandbox session
   * @param path - Directory path
   * @returns List of file paths
   */
  static async listFiles(
    session: SandboxSession,
    path: string = '/'
  ): Promise<string[]> {
    logger.info({ sessionId: session.id, path }, 'Listing files in sandbox');

    try {
      const result = await session.sandbox.commands.run(`find ${path} -type f`);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to list files: ${result.stderr}`);
      }

      const files = result.stdout
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      logger.info({ sessionId: session.id, fileCount: files.length }, 'Files listed successfully');
      return files;

    } catch (error) {
      logger.error({ error, sessionId: session.id, path }, 'Failed to list files');
      throw new Error(`Failed to list files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install packages in the sandbox.
   *
   * @param session - Sandbox session
   * @param packages - Package manager and packages to install
   * @param packageManager - Package manager to use (npm, pip, etc.)
   */
  static async installPackages(
    session: SandboxSession,
    packages: string[],
    packageManager: 'npm' | 'pip' | 'apt' = 'npm'
  ): Promise<ExecutionResult> {
    logger.info({ sessionId: session.id, packages, packageManager }, 'Installing packages in sandbox');

    let command: string;

    switch (packageManager) {
      case 'npm':
        command = `npm install ${packages.join(' ')}`;
        break;
      case 'pip':
        command = `pip install ${packages.join(' ')}`;
        break;
      case 'apt':
        command = `apt-get update && apt-get install -y ${packages.join(' ')}`;
        break;
      default:
        throw new Error(`Unsupported package manager: ${packageManager}`);
    }

    return await E2BSandbox.execute(session, command, 300000); // 5 minutes timeout for installations
  }

  /**
   * Destroy the sandbox and cleanup resources.
   *
   * @param session - Sandbox session to destroy
   */
  static async destroy(session: SandboxSession): Promise<void> {
    logger.info({ sessionId: session.id }, 'Destroying sandbox');

    try {
      await session.sandbox.kill();
      logger.info({ sessionId: session.id }, 'Sandbox destroyed successfully');

    } catch (error) {
      logger.error({ error, sessionId: session.id }, 'Failed to destroy sandbox');
      // Don't throw - best effort cleanup
    }
  }

  /**
   * Get sandbox session info.
   *
   * @param session - Sandbox session
   * @returns Session information
   */
  static getSessionInfo(session: SandboxSession): {
    id: string;
    createdAt: Date;
    uptime: number;
  } {
    return {
      id: session.id,
      createdAt: session.createdAt,
      uptime: Date.now() - session.createdAt.getTime(),
    };
  }

  /**
   * Check if sandbox is still alive.
   *
   * @param session - Sandbox session
   * @returns True if sandbox is responsive
   */
  static async isAlive(session: SandboxSession): Promise<boolean> {
    try {
      const result = await E2BSandbox.execute(session, 'echo "alive"', 5000);
      return result.exitCode === 0 && result.stdout.trim() === 'alive';
    } catch {
      return false;
    }
  }
}
