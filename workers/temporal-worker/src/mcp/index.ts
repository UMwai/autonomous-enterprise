/**
 * MCP (Model Context Protocol) Module
 *
 * Public exports for MCP infrastructure:
 * - Server manager (lifecycle, health checks)
 * - Tool bridge (unified invocation API)
 * - Permission enforcement
 * - Client (low-level protocol access)
 * - Types and configurations
 */

// Core components
export { MCPClient } from './client.js';
export {
  MCPServerManager,
  getMCPManager,
  startMCPManager,
  stopMCPManager,
} from './serverManager.js';
export {
  MCPToolBridge,
  getMCPToolBridge,
  callMCPTool,
  type ToolBridgeConfig,
} from './toolBridge.js';
export {
  checkPermission,
  checkPermissionDetailed,
  enforcePermission,
  requestApproval,
  getPermissionSummary,
  type PermissionCheckResult,
} from './permissions.js';

// Configuration
export {
  MCP_SERVERS,
  getServerConfig,
  getServerIds,
  validateServerConfig,
  getApprovalRequiredTools,
  getBlockedTools,
} from './servers.config.js';

// Types
export type {
  MCPServerConfig,
  PermissionPolicy,
  ToolPermission,
  RateLimit,
  HealthCheckConfig,
  AgentIdentity,
  AgentType,
  ToolCall,
  Tool,
  ServerInstance,
  ToolResult,
  ServerHealth,
  MCPManagerStats,
} from './types.js';
