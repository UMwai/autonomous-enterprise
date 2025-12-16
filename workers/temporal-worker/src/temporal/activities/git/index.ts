/**
 * Git-related Temporal activities
 */

import { execa } from 'execa';
import { mkdir } from 'fs/promises';
import { join } from 'path';

export interface InitRepoInput {
  project_id: string;
  project_name: string;
}

export interface GitTagInput {
  repository_path: string;
  tag: string;
  message: string;
}

export interface PushInput {
  repository_path: string;
  remote_url: string;
}

/**
 * Initialize a new Git repository
 */
export async function initializeGitRepo(input: InitRepoInput): Promise<string> {
  const repoPath = `/tmp/${input.project_id}`;

  // Create directory
  await mkdir(repoPath, { recursive: true });

  // Initialize git
  await execa('git', ['init'], { cwd: repoPath });

  // Configure git
  await execa('git', ['config', 'user.email', 'bot@autonomous-enterprise.ai'], { cwd: repoPath });
  await execa('git', ['config', 'user.name', 'Autonomous Enterprise Bot'], { cwd: repoPath });

  // Create initial commit
  await execa('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: repoPath });

  // Return placeholder URL (would be created via GitHub API in production)
  return `https://github.com/generated/${input.project_id}.git`;
}

/**
 * Create a git tag
 */
export async function createGitTag(input: GitTagInput): Promise<string> {
  // Stage all changes
  await execa('git', ['add', '-A'], { cwd: input.repository_path });

  // Commit
  await execa('git', ['commit', '-m', input.message], { cwd: input.repository_path });

  // Create tag
  await execa('git', ['tag', '-a', input.tag, '-m', input.message], { cwd: input.repository_path });

  // Get commit SHA
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: input.repository_path });

  return stdout.trim();
}

/**
 * Push to remote repository
 */
export async function pushToRemote(input: PushInput): Promise<void> {
  await execa('git', ['remote', 'add', 'origin', input.remote_url], { cwd: input.repository_path }).catch(() => {
    // Remote might already exist
  });

  await execa('git', ['push', '-u', 'origin', 'main', '--tags'], { cwd: input.repository_path });
}
