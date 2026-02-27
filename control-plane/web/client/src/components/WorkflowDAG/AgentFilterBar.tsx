import { Filter, X } from "@/components/ui/icon-bridge";
import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import { cn } from "../../lib/utils";
import { agentColorManager } from "../../utils/agentColorManager";
import { AgentColorDot } from "./AgentBadge";

interface WorkflowDAGNode {
  workflow_id: string;
  execution_id: string;
  agent_node_id: string;
  reasoner_id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  parent_workflow_id?: string;
  parent_execution_id?: string;
  workflow_depth: number;
  children: WorkflowDAGNode[];
  agent_name?: string;
  task_name?: string;
}

interface AgentFilterBarProps {
  nodes: Node[];
  onAgentFilter: (agentName: string | null) => void;
  selectedAgent: string | null;
}

export function AgentFilterBar({
  nodes,
  onAgentFilter,
  selectedAgent,
}: AgentFilterBarProps) {
  // Extract unique agents from nodes
  const agents = useMemo(() => {
    const agentSet = new Set<string>();

    nodes.forEach((node) => {
      const nodeData = node.data as unknown as WorkflowDAGNode;
      const agentName = nodeData.agent_name || nodeData.agent_node_id;
      if (agentName) {
        agentSet.add(agentName);
      }
    });

    return Array.from(agentSet);
  }, [nodes]);

  // Get agent colors
  const agentColors = useMemo(() => {
    return agents.map((agentName) => agentColorManager.getAgentColor(agentName));
  }, [agents]);

  // Don't render if no agents
  if (agentColors.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2">
        <Filter size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium shrink-0">
          Agents ({agentColors.length})
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {agentColors.map((agent) => (
            <button
              key={agent.name}
              onClick={() =>
                onAgentFilter(
                  selectedAgent === agent.name ? null : agent.name
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
                "border transition-all duration-150",
                "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                selectedAgent === agent.name
                  ? "bg-muted ring-2 ring-primary/30 border-primary/30"
                  : "border-border bg-background"
              )}
            >
              <AgentColorDot agentName={agent.name} size={8} />
              <span className="truncate max-w-[120px]">{agent.name}</span>
            </button>
          ))}
          {selectedAgent && (
            <button
              onClick={() => onAgentFilter(null)}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs",
                "text-muted-foreground hover:text-foreground transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
              title="Clear filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="border-b-2 border-border" />
    </div>
  );
}
