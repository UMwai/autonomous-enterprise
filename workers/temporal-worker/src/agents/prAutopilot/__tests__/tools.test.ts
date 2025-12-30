/**
 * PR Autopilot Tools Tests
 *
 * Unit tests for dependency parsing utility functions.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock @octokit/rest to avoid import issues in tests
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(),
}));

// Mock pino logger
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Now we can safely import tools
const { parseDependencyFile } = await import('../tools.js');

describe('PR Autopilot Tools', () => {
  describe('parseDependencyFile', () => {
    it('should parse package.json dependencies', () => {
      const content = JSON.stringify({
        dependencies: {
          'axios': '^0.21.1',
          'lodash': '~4.17.20',
        },
        devDependencies: {
          'typescript': '>=5.0.0',
        },
      });

      const deps = parseDependencyFile('package.json', content);

      expect(deps).toHaveLength(3);
      expect(deps[0]).toEqual({ name: 'axios', version: '0.21.1', ecosystem: 'npm' });
      expect(deps[1]).toEqual({ name: 'lodash', version: '4.17.20', ecosystem: 'npm' });
      expect(deps[2]).toEqual({ name: 'typescript', version: '5.0.0', ecosystem: 'npm' });
    });

    it('should parse requirements.txt dependencies', () => {
      const content = `
requests==2.28.1
flask==2.3.0
pytest==7.4.0
`;

      const deps = parseDependencyFile('requirements.txt', content);

      expect(deps).toHaveLength(3);
      expect(deps[0]).toEqual({ name: 'requests', version: '2.28.1', ecosystem: 'PyPI' });
      expect(deps[1]).toEqual({ name: 'flask', version: '2.3.0', ecosystem: 'PyPI' });
      expect(deps[2]).toEqual({ name: 'pytest', version: '7.4.0', ecosystem: 'PyPI' });
    });

    it('should parse go.mod dependencies', () => {
      const content = `
module example.com/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`;

      const deps = parseDependencyFile('go.mod', content);

      expect(deps).toHaveLength(2);
      expect(deps[0]).toEqual({ name: 'github.com/gin-gonic/gin', version: '1.9.1', ecosystem: 'Go' });
      expect(deps[1]).toEqual({ name: 'github.com/stretchr/testify', version: '1.8.4', ecosystem: 'Go' });
    });

    it('should return empty array for unknown file format', () => {
      const content = 'some random content';
      const deps = parseDependencyFile('unknown.txt', content);

      expect(deps).toEqual([]);
    });

    it('should handle malformed package.json gracefully', () => {
      const content = 'not valid json';
      const deps = parseDependencyFile('package.json', content);

      expect(deps).toEqual([]);
    });

    it('should handle package.json without dependencies', () => {
      const content = JSON.stringify({
        name: 'my-package',
        version: '1.0.0',
      });

      const deps = parseDependencyFile('package.json', content);

      expect(deps).toEqual([]);
    });
  });
});
