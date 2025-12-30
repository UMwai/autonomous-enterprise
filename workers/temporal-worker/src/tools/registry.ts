/**
 * Tool registry implementation.
 *
 * Provides a centralized registry for discovering and retrieving atomic tools.
 */

import type { AtomicTool, ToolCategory, ToolInfo, ToolRegistry } from './types.js';
import { RiskLevel } from './types.js';

/**
 * Default implementation of ToolRegistry.
 */
export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, AtomicTool>();

  /**
   * Register a tool in the registry.
   *
   * @param tool - Tool to register
   * @throws Error if a tool with the same name already exists
   */
  register(tool: AtomicTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   *
   * @param name - Name of the tool to retrieve
   * @returns The tool, or undefined if not found
   */
  get(name: string): AtomicTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools in a category.
   *
   * @param category - Category to filter by
   * @returns Array of tools in the category
   */
  getByCategory(category: ToolCategory): AtomicTool[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.category === category
    );
  }

  /**
   * Get all tools with risk level at or below the specified level.
   *
   * @param maxRisk - Maximum risk level to include
   * @returns Array of tools within the risk threshold
   */
  getByMaxRisk(maxRisk: RiskLevel): AtomicTool[] {
    const riskOrder: Record<RiskLevel, number> = {
      [RiskLevel.SAFE]: 0,
      [RiskLevel.LOW]: 1,
      [RiskLevel.MEDIUM]: 2,
      [RiskLevel.HIGH]: 3,
      [RiskLevel.CRITICAL]: 4,
    };

    const maxRiskLevel = riskOrder[maxRisk];

    return Array.from(this.tools.values()).filter(
      (tool) => riskOrder[tool.riskLevel] <= maxRiskLevel
    );
  }

  /**
   * List all registered tools.
   *
   * @returns Array of tool metadata
   */
  list(): ToolInfo[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskLevel: tool.riskLevel,
      estimatedCost: tool.estimatedCost,
    }));
  }

  /**
   * Get the number of registered tools.
   *
   * @returns Count of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Check if a tool is registered.
   *
   * @param name - Name of the tool to check
   * @returns True if the tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Unregister a tool.
   *
   * @param name - Name of the tool to unregister
   * @returns True if the tool was unregistered, false if it wasn't registered
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }
}
