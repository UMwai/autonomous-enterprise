/**
 * Git Repository Operations
 *
 * Provides git operations for autonomous coding workflows including
 * initialization, cloning, committing, pushing, and branch management.
 */

import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Git operation result
 */
export interface GitResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

/**
 * Git commit options
 */
export interface CommitOptions {
  /** Commit message */
  message: string;

  /** Author name (default: uses git config) */
  author?: string;

  /** Author email (default: uses git config) */
  email?: string;

  /** Allow empty commits */
  allowEmpty?: boolean;

  /** Amend previous commit */
  amend?: boolean;

  /** Co-authors to add */
  coAuthors?: Array<{
    name: string;
    email: string;
  }>;
}

/**
 * Git push options
 */
export interface PushOptions {
  /** Remote name (default: origin) */
  remote?: string;

  /** Branch name */
  branch: string;

  /** Force push */
  force?: boolean;

  /** Set upstream */
  setUpstream?: boolean;
}

/**
 * Git clone options
 */
export interface CloneOptions {
  /** Branch to clone */
  branch?: string;

  /** Depth for shallow clone */
  depth?: number;

  /** Single branch clone */
  singleBranch?: boolean;

  /** Recurse submodules */
  recurseSubmodules?: boolean;
}

/**
 * Git Operations Class
 */
export class GitOperations {
  private readonly gitBinary: string;

  constructor(gitBinary = 'git') {
    this.gitBinary = gitBinary;
  }

  /**
   * Initialize a new git repository
   */
  async init(path: string, options?: { bare?: boolean; branch?: string }): Promise<GitResult> {
    try {
      const args = ['init'];

      if (options?.bare) {
        args.push('--bare');
      }

      if (options?.branch) {
        args.push('--initial-branch', options.branch);
      }

      args.push(path);

      const result = await execa(this.gitBinary, args, {
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Clone a repository
   */
  async clone(url: string, path: string, options?: CloneOptions): Promise<GitResult> {
    try {
      const args = ['clone'];

      if (options?.branch) {
        args.push('--branch', options.branch);
      }

      if (options?.depth) {
        args.push('--depth', String(options.depth));
      }

      if (options?.singleBranch) {
        args.push('--single-branch');
      }

      if (options?.recurseSubmodules) {
        args.push('--recurse-submodules');
      }

      args.push(url, path);

      const result = await execa(this.gitBinary, args, {
        all: true,
        reject: false,
        timeout: 300000, // 5 minutes for large repos
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Stage and commit changes
   */
  async commit(path: string, options: CommitOptions): Promise<GitResult> {
    try {
      // Ensure we're in a git repository
      if (!this.isGitRepository(path)) {
        return {
          success: false,
          output: '',
          error: 'Not a git repository',
        };
      }

      // Stage all changes
      const stageResult = await execa(this.gitBinary, ['add', '.'], {
        cwd: path,
        all: true,
        reject: false,
      });

      if (stageResult.exitCode !== 0) {
        return {
          success: false,
          output: stageResult.all || stageResult.stdout,
          error: stageResult.stderr || 'Failed to stage changes',
          exitCode: stageResult.exitCode,
        };
      }

      // Build commit message with co-authors
      let commitMessage = options.message;
      if (options.coAuthors && options.coAuthors.length > 0) {
        commitMessage += '\n\n';
        for (const coAuthor of options.coAuthors) {
          commitMessage += `Co-authored-by: ${coAuthor.name} <${coAuthor.email}>\n`;
        }
      }

      // Build commit arguments
      const args = ['commit', '-m', commitMessage];

      if (options.allowEmpty) {
        args.push('--allow-empty');
      }

      if (options.amend) {
        args.push('--amend');
      }

      if (options.author && options.email) {
        args.push('--author', `${options.author} <${options.email}>`);
      }

      // Execute commit
      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Push to remote
   */
  async push(path: string, options: PushOptions): Promise<GitResult> {
    try {
      const args = ['push'];

      if (options.setUpstream) {
        args.push('--set-upstream');
      }

      if (options.force) {
        args.push('--force');
      }

      const remote = options.remote || 'origin';
      args.push(remote, options.branch);

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
        timeout: 120000, // 2 minutes for push
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(path: string, name: string, options?: { checkout?: boolean; from?: string }): Promise<GitResult> {
    try {
      const args = ['branch', name];

      if (options?.from) {
        args.push(options.from);
      }

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: result.all || result.stdout,
          error: result.stderr || 'Failed to create branch',
          exitCode: result.exitCode,
        };
      }

      // Checkout if requested
      if (options?.checkout) {
        const checkoutResult = await this.checkout(path, name);
        if (!checkoutResult.success) {
          return checkoutResult;
        }
      }

      return {
        success: true,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Checkout a branch
   */
  async checkout(path: string, branch: string, options?: { create?: boolean }): Promise<GitResult> {
    try {
      const args = ['checkout'];

      if (options?.create) {
        args.push('-b');
      }

      args.push(branch);

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(path: string): Promise<GitResult> {
    try {
      const result = await execa(this.gitBinary, ['branch', '--show-current'], {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: (result.stdout || '').trim(),
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get repository status
   */
  async status(path: string, options?: { short?: boolean }): Promise<GitResult> {
    try {
      const args = ['status'];

      if (options?.short) {
        args.push('--short');
      }

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Pull from remote
   */
  async pull(path: string, options?: { remote?: string; branch?: string; rebase?: boolean }): Promise<GitResult> {
    try {
      const args = ['pull'];

      if (options?.rebase) {
        args.push('--rebase');
      }

      if (options?.remote) {
        args.push(options.remote);
      }

      if (options?.branch) {
        args.push(options.branch);
      }

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
        timeout: 120000, // 2 minutes
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get commit log
   */
  async log(path: string, options?: { maxCount?: number; oneline?: boolean; format?: string }): Promise<GitResult> {
    try {
      const args = ['log'];

      if (options?.maxCount) {
        args.push(`-n`, String(options.maxCount));
      }

      if (options?.oneline) {
        args.push('--oneline');
      }

      if (options?.format) {
        args.push(`--format=${options.format}`);
      }

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add remote
   */
  async addRemote(path: string, name: string, url: string): Promise<GitResult> {
    try {
      const result = await execa(this.gitBinary, ['remote', 'add', name, url], {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if directory is a git repository
   */
  isGitRepository(path: string): boolean {
    return existsSync(join(path, '.git'));
  }

  /**
   * Get diff
   */
  async diff(path: string, options?: { cached?: boolean; stat?: boolean }): Promise<GitResult> {
    try {
      const args = ['diff'];

      if (options?.cached) {
        args.push('--cached');
      }

      if (options?.stat) {
        args.push('--stat');
      }

      const result = await execa(this.gitBinary, args, {
        cwd: path,
        all: true,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        output: result.all || result.stdout,
        exitCode: result.exitCode,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(path: string): Promise<boolean> {
    const statusResult = await this.status(path, { short: true });
    return statusResult.success && statusResult.output.trim().length > 0;
  }

  /**
   * Get list of modified files
   */
  async getModifiedFiles(path: string): Promise<string[]> {
    try {
      const result = await execa(this.gitBinary, ['diff', '--name-only'], {
        cwd: path,
        all: true,
        reject: false,
      });

      if (result.exitCode === 0 && result.stdout) {
        return result.stdout.split('\n').filter(Boolean);
      }

      return [];
    } catch {
      return [];
    }
  }
}
