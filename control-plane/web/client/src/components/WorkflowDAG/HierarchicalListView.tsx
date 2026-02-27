"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useVirtualizer } from '@tanstack/react-virtual';
// Uses @radix-ui/react-collapsible for tree structure collapse/expand functionality
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronRight,
  CheckmarkFilled,
  ErrorFilled,
  InProgress,
  PauseFilled,
  Time,
  Calendar,
  User,
} from '@/components/ui/icon-bridge';
import { cn } from '@/lib/utils';
import { agentColorManager, type AgentColor } from '@/utils/agentColorManager';
import {
  normalizeExecutionStatus,
  getStatusLabel,
  getStatusTheme,
  type CanonicalStatus,
} from '@/utils/status';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

// ============================================================================
// Type Definitions
// ============================================================================

interface TreeNode {
  node: Node;
  children: TreeNode[];
  depth: number;
}

interface HierarchicalListViewProps {
  nodes: Node[];
  onNodeClick: (node: Node) => void;
  workflowId: string;
  viewMode?: 'standard' | 'performance' | 'debug';
  durationStats?: {
    max: number;
    min: number;
    avg: number;
  };
}

interface ListItemProps {
  treeNode: TreeNode;
  expandedSet: Set<string>;
  onToggleExpand: (executionId: string) => void;
  onNodeClick: (node: Node) => void;
  viewMode: 'standard' | 'performance' | 'debug';
  agentColorManager: typeof agentColorManager;
  durationStats: { max: number; min: number; avg: number };
}

interface FlattenedNode {
  treeNode: TreeNode;
  isVisible: boolean;
}

// Type guard for decorated node data
type DecoratedWorkflowDAGNode = {
  workflow_id: string;
  execution_id: string;
  agent_node_id: string;
  reasoner_id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  parent_execution_id?: string;
  workflow_depth: number;
  agent_name?: string;
  task_name?: string;
  isSearchMatch?: boolean;
  isDimmed?: boolean;
  isFocusPrimary?: boolean;
  isFocusRelated?: boolean;
  focusDistance?: number;
  viewMode?: 'standard' | 'performance' | 'debug';
  performanceIntensity?: number;
};

// ============================================================================
// Tree Building Algorithm
// ============================================================================

/**
 * Builds a hierarchical tree from flat node array using parent_execution_id.
 *
 * Algorithm:
 * 1. Create lookup maps: id → node, id → children[]
 * 2. Identify root nodes (no parent or orphaned parent)
 * 3. Recursively build tree from each root
 *
 * Complexity: O(n) where n = number of nodes
 * - Single pass to build maps: O(n)
 * - Single pass to identify roots: O(n)
 * - Tree construction visits each node once: O(n)
 */
function buildTree(nodes: Node[]): TreeNode[] {
  // Build lookup maps
  const nodeMap = new Map<string, Node>();
  const childrenMap = new Map<string, Node[]>();

  nodes.forEach(node => {
    nodeMap.set(node.id, node);
  });

  // Group nodes by parent
  nodes.forEach(node => {
    const data = node.data as DecoratedWorkflowDAGNode;
    const parentId = data.parent_execution_id;

    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(node);
    }
  });

  // Sort children by started_at timestamp (earliest first)
  childrenMap.forEach(children => {
    children.sort((a, b) => {
      const dataA = a.data as DecoratedWorkflowDAGNode;
      const dataB = b.data as DecoratedWorkflowDAGNode;
      return dataA.started_at.localeCompare(dataB.started_at);
    });
  });

  // Find root nodes (no parent or parent doesn't exist)
  const rootNodes: Node[] = [];
  nodes.forEach(node => {
    const data = node.data as DecoratedWorkflowDAGNode;
    const parentId = data.parent_execution_id;

    if (!parentId || !nodeMap.has(parentId)) {
      rootNodes.push(node);
    }
  });

  // Sort roots by started_at
  rootNodes.sort((a, b) => {
    const dataA = a.data as DecoratedWorkflowDAGNode;
    const dataB = b.data as DecoratedWorkflowDAGNode;
    return dataA.started_at.localeCompare(dataB.started_at);
  });

  // Recursive tree builder
  const buildSubtree = (node: Node, depth: number): TreeNode => {
    const children = childrenMap.get(node.id) || [];
    return {
      node,
      depth,
      children: children.map(child => buildSubtree(child, depth + 1)),
    };
  };

  return rootNodes.map(root => buildSubtree(root, 0));
}

// ============================================================================
// Auto-Expand Logic for Search and Focus
// ============================================================================

/**
 * Computes which nodes should be auto-expanded based on search matches and focus.
 *
 * Strategy:
 * 1. Build ancestor map: child → [parent, grandparent, ...]
 * 2. For each search match or focused node, expand all ancestors
 * 3. Return Set of execution_ids that should be expanded
 *
 * Complexity: O(n × d) where n = nodes, d = max depth
 */
function computeAutoExpandedNodes(
  nodes: Node[],
  tree: TreeNode[]
): Set<string> {
  const expanded = new Set<string>();

  // Build ancestor map for efficient lookups
  const ancestorMap = new Map<string, string[]>();

  const buildAncestorPaths = (treeNode: TreeNode, ancestors: string[]) => {
    ancestorMap.set(treeNode.node.id, [...ancestors]);

    const newAncestors = [...ancestors, treeNode.node.id];
    treeNode.children.forEach(child => {
      buildAncestorPaths(child, newAncestors);
    });
  };

  tree.forEach(root => buildAncestorPaths(root, []));

  // Find nodes that require expansion
  nodes.forEach(node => {
    const data = node.data as DecoratedWorkflowDAGNode;

    // Auto-expand if this node is a search match or focused
    if (data.isSearchMatch || data.isFocusPrimary || data.isFocusRelated) {
      const ancestors = ancestorMap.get(node.id) || [];
      ancestors.forEach(ancestorId => expanded.add(ancestorId));
    }
  });

  return expanded;
}

// ============================================================================
// List Item Component (Recursive)
// ============================================================================

/**
 * ListItem - Renders a single node with collapsible children.
 *
 * Recursively renders the tree structure. Each item:
 * - Shows chevron (if has children)
 * - Shows status icon
 * - Shows agent badge, task name, duration, timestamp
 * - Handles click to open sidebar
 * - Renders nested children when expanded
 */
function ListItem({
  treeNode,
  expandedSet,
  onToggleExpand,
  onNodeClick,
  viewMode,
  agentColorManager,
  durationStats,
}: ListItemProps) {
  const { node, children, depth } = treeNode;
  const data = node.data as DecoratedWorkflowDAGNode;

  const hasChildren = children.length > 0;
  const isExpanded = expandedSet.has(data.execution_id);

  // Status processing
  const normalizedStatus = normalizeExecutionStatus(data.status);
  const statusTheme = getStatusTheme(data.status);
  const statusLabel = getStatusLabel(data.status);

  // Agent color
  const agentColor = agentColorManager.getAgentColor(
    data.agent_name || data.agent_node_id,
    data.agent_node_id
  );

  // Formatting utilities
  const formatDuration = (durationMs?: number) => {
    if (!durationMs) return '-';
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const humanizeText = (text: string): string => {
    return text
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Status icon
  const getStatusIcon = (status: CanonicalStatus) => {
    const iconClass = cn('h-4 w-4', statusTheme.iconClass);
    const iconProps = { size: 16, className: iconClass };

    switch (status) {
      case 'succeeded':
        return <CheckmarkFilled {...iconProps} />;
      case 'failed':
        return <ErrorFilled {...iconProps} />;
      case 'running':
        return <InProgress {...iconProps} className={cn(iconClass, 'animate-spin')} />;
      case 'pending':
      case 'queued':
        return <PauseFilled {...iconProps} />;
      case 'timeout':
        return <Time {...iconProps} />;
      default:
        return <span className="inline-flex h-4 w-4 rounded-full bg-muted-foreground/60" />;
    }
  };

  // Styling based on decoration flags
  const isDimmed = data.isDimmed ?? false;
  const isSearchMatch = data.isSearchMatch ?? false;
  const isFocusPrimary = data.isFocusPrimary ?? false;

  // Calculate indentation (24px per depth level, max 240px at depth 10)
  const indentPx = Math.min(depth * 24, 240);

  // Background color varies by depth (subtle)
  const depthOpacity = Math.min(depth * 0.02, 0.1); // Max 10% opacity

  // Performance mode color
  const performanceIntensity = data.performanceIntensity ?? 0;

  // Border and highlight colors
  let borderColor = 'var(--border)';
  let bgColor = `color-mix(in srgb, var(--muted) ${depthOpacity * 100}%, transparent)`;

  if (isFocusPrimary) {
    borderColor = 'var(--status-success-border)';
    bgColor = 'color-mix(in srgb, var(--status-success) 8%, transparent)';
  } else if (isSearchMatch) {
    borderColor = 'var(--status-info-border)';
    bgColor = 'color-mix(in srgb, var(--status-info) 6%, transparent)';
  } else if (viewMode === 'performance') {
    const heat = Math.min(65, 25 + performanceIntensity * 45);
    bgColor = `color-mix(in srgb, var(--status-warning) ${heat}%, transparent)`;
    borderColor = `color-mix(in srgb, var(--status-warning) ${Math.min(55, 35 + performanceIntensity * 25)}%, transparent)`;
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={() => onToggleExpand(data.execution_id)}>
      <div
        className={cn(
          'border-b border-border/50 transition-all duration-200',
          !isDimmed && 'hover:bg-muted/30'
        )}
        style={{
          paddingLeft: `${indentPx}px`,
          opacity: isDimmed ? 0.35 : 1,
          filter: isDimmed ? 'grayscale(65%)' : undefined,
        }}
        data-item-id={data.execution_id}
      >
        {/* Main row */}
        <div
          className={cn(
            'flex items-center gap-2 py-2 px-3 cursor-pointer',
            'relative'
          )}
          style={{
            backgroundColor: bgColor,
            borderLeft: `3px solid ${agentColor.primary}`,
          }}
          onClick={(e) => {
            // Only trigger node click if not clicking chevron
            if (!(e.target as HTMLElement).closest('[data-chevron]')) {
              onNodeClick(node);
            }
          }}
        >
          {/* Chevron (if has children) */}
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center" data-chevron>
            {hasChildren ? (
              <CollapsibleTrigger asChild>
                <button
                  className="flex items-center justify-center w-full h-full text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(data.execution_id);
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>
              </CollapsibleTrigger>
            ) : (
              <div className="w-4" /> // Spacer for alignment
            )}
          </div>

          {/* Status icon */}
          <div className="flex-shrink-0">
            {getStatusIcon(normalizedStatus)}
          </div>

          {/* Agent name */}
          <div
            className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: agentColor.background,
              color: agentColor.text,
              borderLeft: `2px solid ${agentColor.primary}`,
            }}
            title={humanizeText(data.agent_name || data.agent_node_id)}
          >
            {humanizeText(data.agent_name || data.agent_node_id)}
          </div>

          {/* Task name */}
          <div className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
            {humanizeText(data.task_name || data.reasoner_id)}
          </div>

          {/* Duration */}
          <div className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
            <Time size={12} />
            <span className="font-mono">{formatDuration(data.duration_ms)}</span>
          </div>

          {/* Timestamp */}
          <div className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar size={12} />
            <span className="font-mono">{formatTimestamp(data.started_at)}</span>
          </div>

          {/* Status label */}
          <div className={cn('flex-shrink-0 text-xs font-medium', statusTheme.textClass)}>
            {statusLabel}
          </div>
        </div>

        {/* Debug mode: Technical details */}
        {viewMode === 'debug' && (
          <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground bg-muted/20 border-t border-border/30">
            <div>Execution ID: {data.execution_id}</div>
            {data.parent_execution_id && <div>Parent: {data.parent_execution_id.slice(0, 12)}...</div>}
            <div>Agent Node: {data.agent_node_id}</div>
          </div>
        )}

        {/* Performance mode: Progress bar */}
        {viewMode === 'performance' && (
          <div className="px-3 py-1 border-t border-border/30">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-status-warning transition-all duration-300"
                style={{ width: `${Math.max(6, performanceIntensity * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>Load {(performanceIntensity * 100).toFixed(0)}%</span>
              {data.duration_ms && <span>{formatDuration(data.duration_ms)}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Nested children */}
      {hasChildren && (
        <CollapsibleContent>
          {children.map(child => (
            <ListItem
              key={child.node.id}
              treeNode={child}
              expandedSet={expandedSet}
              onToggleExpand={onToggleExpand}
              onNodeClick={onNodeClick}
              viewMode={viewMode}
              agentColorManager={agentColorManager}
              durationStats={durationStats}
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function HierarchicalListView({
  nodes,
  onNodeClick,
  workflowId,
  viewMode = 'standard',
  durationStats,
}: HierarchicalListViewProps) {
  // Build tree structure
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Calculate duration stats if not provided
  const computedDurationStats = useMemo(() => {
    if (durationStats && durationStats.max > 0) return durationStats;

    const durations = nodes
      .map(n => (n.data as DecoratedWorkflowDAGNode).duration_ms || 0)
      .filter(d => d > 0);

    if (durations.length === 0) return { max: 0, min: 0, avg: 0 };

    return {
      max: Math.max(...durations),
      min: Math.min(...durations),
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
    };
  }, [nodes, durationStats]);

  // Expansion state management
  const storageKey = `workflowListExpansion:${workflowId}`;

  // Initialize expansion state from localStorage or auto-expand
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (error) {
      console.warn('Failed to load expansion state from localStorage:', error);
    }

    // Default: auto-expand for search/focus
    return computeAutoExpandedNodes(nodes, tree);
  });

  // Update auto-expand when search or focus changes
  useEffect(() => {
    const autoExpanded = computeAutoExpandedNodes(nodes, tree);
    if (autoExpanded.size > 0) {
      setExpandedSet(prev => {
        const merged = new Set([...prev, ...autoExpanded]);
        return merged;
      });
    }
  }, [nodes, tree]);

  // Persist expansion state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expandedSet]));
    } catch (error) {
      console.warn('Failed to persist expansion state to localStorage:', error);
    }
  }, [expandedSet, storageKey]);

  // Toggle expansion handler
  const handleToggleExpand = useCallback((executionId: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(executionId)) {
        next.delete(executionId);
      } else {
        next.add(executionId);
      }
      return next;
    });
  }, []);

  // Virtualization for large lists
  const shouldVirtualize = nodes.length > 300;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flatten tree for virtualization
  const flattenedNodes = useMemo(() => {
    const flattened: FlattenedNode[] = [];

    const traverse = (treeNode: TreeNode, parentExpanded: boolean) => {
      const isVisible = parentExpanded;
      flattened.push({ treeNode, isVisible });

      if (expandedSet.has(treeNode.node.id)) {
        treeNode.children.forEach(child => traverse(child, isVisible));
      }
    };

    tree.forEach(root => traverse(root, true));
    return flattened.filter(fn => fn.isVisible);
  }, [tree, expandedSet]);

  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 50, // Estimated row height
    overscan: 10,
  });

  // Render virtualized or non-virtualized
  if (nodes.length === 0) {
    return (
      <Card className="flex h-full items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          No nodes to display
        </CardContent>
      </Card>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className="flex flex-col h-full">
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
          style={{ contain: 'strict' }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualItem => {
              const { treeNode } = flattenedNodes[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <ListItem
                    treeNode={treeNode}
                    expandedSet={expandedSet}
                    onToggleExpand={handleToggleExpand}
                    onNodeClick={onNodeClick}
                    viewMode={viewMode}
                    agentColorManager={agentColorManager}
                    durationStats={computedDurationStats}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Non-virtualized rendering
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {tree.map(rootNode => (
          <ListItem
            key={rootNode.node.id}
            treeNode={rootNode}
            expandedSet={expandedSet}
            onToggleExpand={handleToggleExpand}
            onNodeClick={onNodeClick}
            viewMode={viewMode}
            agentColorManager={agentColorManager}
            durationStats={computedDurationStats}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
