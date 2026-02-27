import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { EnhancedWorkflowHeader } from "../components/workflow/EnhancedWorkflowHeader";
import { EnhancedWorkflowTabs } from "../components/workflow/EnhancedWorkflowTabs";
import { EnhancedWorkflowFlow } from "../components/workflow/EnhancedWorkflowFlow";
import { EnhancedWorkflowData } from "../components/workflow/EnhancedWorkflowData";
import { EnhancedWorkflowEvents } from "../components/workflow/EnhancedWorkflowEvents";
import { ResponsiveGrid } from "@/components/layout/ResponsiveGrid";
import { Skeleton } from "@/components/ui/skeleton";
import { EnhancedWorkflowPerformance } from "../components/workflow/EnhancedWorkflowPerformance";
import { EnhancedWorkflowOverview } from "../components/workflow/EnhancedWorkflowOverview";
import { EnhancedWorkflowIdentity } from "../components/workflow/EnhancedWorkflowIdentity";
import { EnhancedWorkflowWebhooks } from "../components/workflow/EnhancedWorkflowWebhooks";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { HierarchicalListView } from "../components/WorkflowDAG/HierarchicalListView";
import { AgentFilterBar } from "../components/WorkflowDAG/AgentFilterBar";
import { NodeDetailSidebar } from "../components/WorkflowDAG/NodeDetailSidebar";
import { getWorkflowRunSummary } from "../services/workflowsApi";
import { getWorkflowVCChain } from "../services/vcApi";
import { useWorkflowDAGSmart } from "../hooks/useWorkflowDAG";
import type { WorkflowSummary } from "../types/workflows";
import type { WorkflowVCChainResponse } from "../types/did";
import type { Node } from "@xyflow/react";
import { normalizeExecutionStatus } from "../utils/status";

type TabType = 'graph' | 'list' | 'io' | 'webhooks' | 'notes' | 'identity' | 'insights';

const WORKFLOW_TAB_VALUES = ['graph', 'list', 'io', 'webhooks', 'notes', 'identity', 'insights'] as const;
const DEFAULT_WORKFLOW_TAB: TabType = 'graph';

function isWorkflowTab(value: string | null): value is TabType {
  return value !== null && WORKFLOW_TAB_VALUES.includes(value as TabType);
}

function getWorkflowViewPreference(workflowId: string): TabType | null {
  try {
    const stored = localStorage.getItem(`workflowViewPreference:${workflowId}`);
    if (stored === 'graph' || stored === 'list') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

function setWorkflowViewPreference(workflowId: string, tab: 'graph' | 'list') {
  try {
    localStorage.setItem(`workflowViewPreference:${workflowId}`, tab);
  } catch {
    // localStorage unavailable
  }
}

function resolveWorkflowTab(value: string | null, workflowId?: string): TabType {
  // If URL has an explicit non-graph/non-null tab, use it directly
  if (isWorkflowTab(value) && value !== 'graph') {
    return value;
  }
  // For no tab or tab=graph (the default), check localStorage preference
  if (workflowId) {
    const preference = getWorkflowViewPreference(workflowId);
    if (preference) {
      return preference;
    }
  }
  // If URL explicitly says graph, or no preference stored, use graph
  if (isWorkflowTab(value)) {
    return value;
  }
  return DEFAULT_WORKFLOW_TAB;
}

export function EnhancedWorkflowDetailPage() {
  const { workflowId: runId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Core data state
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [vcChain, setVcChain] = useState<WorkflowVCChainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state derived from URL
  const activeTab = resolveWorkflowTab(searchParams.get('tab'), runId);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Enhanced workflow state
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [viewMode, setViewMode] = useState<'standard' | 'performance' | 'debug'>('standard');

  // List tab state
  const [listSelectedNode, setListSelectedNode] = useState<Node | null>(null);
  const [listSidebarOpen, setListSidebarOpen] = useState(false);
  const [listSelectedAgent, setListSelectedAgent] = useState<string | null>(null);

  // Use smart polling hook for DAG data
  const {
    data: dagData,
    loading: dagLoading,
    error: dagError,
    isRefreshing: dagRefreshing,
    hasRunningWorkflows,
    currentPollingInterval,
    refresh: refreshDAG
  } = useWorkflowDAGSmart(runId || null);

  const timelineForStatus = dagData?.timeline ?? [];
  const aggregatedStatus = normalizeExecutionStatus(
    dagData?.workflow_status ?? workflow?.status ?? 'unknown'
  );

  const timelineStatusCounts = useMemo(() => {
    if (!timelineForStatus.length) {
      return null;
    }
    return timelineForStatus.reduce<Record<string, number>>((acc, node) => {
      const normalized = normalizeExecutionStatus(node.status);
      acc[normalized] = (acc[normalized] ?? 0) + 1;
      return acc;
    }, {});
  }, [timelineForStatus]);

  const timelineActiveExecutions = useMemo(() => {
    if (!timelineForStatus.length) {
      return null;
    }
    return timelineForStatus.reduce((acc, node) => {
      const normalized = normalizeExecutionStatus(node.status);
      if (
        normalized === 'running' ||
        normalized === 'queued' ||
        normalized === 'pending'
      ) {
        return acc + 1;
      }
      return acc;
    }, 0);
  }, [timelineForStatus]);

  const timelineTerminal = useMemo(() => {
    if (!timelineForStatus.length) {
      return null;
    }
    return timelineForStatus.every((node) => {
      const normalized = normalizeExecutionStatus(node.status);
      return (
        normalized === 'succeeded' ||
        normalized === 'failed' ||
        normalized === 'timeout' ||
        normalized === 'cancelled'
      );
    });
  }, [timelineForStatus]);

  const displayWorkflow = useMemo<WorkflowSummary | null>(() => {
    if (!workflow) {
      return null;
    }

    const statusCounts = timelineStatusCounts ?? workflow.status_counts;
    const activeExecutions =
      timelineActiveExecutions ?? workflow.active_executions;
    const terminal = timelineTerminal ?? workflow.terminal;

    return {
      ...workflow,
      status: aggregatedStatus,
      total_executions:
        timelineForStatus.length || workflow.total_executions || 0,
      max_depth: dagData?.max_depth ?? workflow.max_depth,
      duration_ms: dagData?.dag?.duration_ms ?? workflow.duration_ms,
      status_counts: statusCounts,
      active_executions: activeExecutions,
      terminal,
    };
  }, [
    workflow,
    aggregatedStatus,
    timelineForStatus.length,
    dagData?.max_depth,
    dagData?.dag?.duration_ms,
    timelineStatusCounts,
    timelineActiveExecutions,
    timelineTerminal,
  ]);

  // Convert timeline data to Node[] for HierarchicalListView
  const listViewNodes = useMemo<Node[]>(() => {
    const timeline = dagData?.timeline ?? [];
    return timeline.map((execution) => ({
      id: execution.execution_id,
      type: "workflow",
      position: { x: 0, y: 0 },
      data: {
        ...execution,
        viewMode,
      },
    }));
  }, [dagData?.timeline, viewMode]);

  // Filter nodes by selected agent
  const filteredListViewNodes = useMemo<Node[]>(() => {
    if (!listSelectedAgent) return listViewNodes;
    return listViewNodes.filter((node) => {
      const data = node.data as Record<string, unknown>;
      const agentName = (data.agent_name as string) || (data.agent_node_id as string);
      return agentName === listSelectedAgent;
    });
  }, [listViewNodes, listSelectedAgent]);

  // Handle node click in list view
  const handleListNodeClick = useCallback((node: Node) => {
    setListSelectedNode(node);
    setListSidebarOpen(true);
  }, []);

  // Handle agent filter in list view
  const handleListAgentFilter = useCallback((agentName: string | null) => {
    setListSelectedAgent(agentName);
  }, []);

  // Handle list sidebar close
  const handleListSidebarClose = useCallback(() => {
    setListSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!runId) {
      navigate("/workflows");
      return;
    }

    const controller = new AbortController();

    const fetchWorkflow = async () => {
      try {
        setLoading(true);
        setError(null);

        const workflowSummary = await getWorkflowRunSummary(runId, controller.signal);

        if (!workflowSummary) {
          setError("Workflow run not found");
          return;
        }

        setWorkflow(workflowSummary);

        try {
          const vcData = await getWorkflowVCChain(workflowSummary.workflow_id);
          setVcChain(vcData);
        } catch (vcError) {
          console.error('Failed to fetch VC chain:', vcError);
          setVcChain(null);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load workflow");
      } finally {
        setLoading(false);
      }
    };

    fetchWorkflow();

    return () => {
      controller.abort();
    };
  }, [runId, navigate]);

  const handleTabChange = useCallback((tab: TabType) => {
    if (tab === 'graph' && selectedNodeIds.length === 0 && dagData?.timeline?.[0]) {
      setSelectedNodeIds([dagData.timeline[0].execution_id]);
    }

    // Persist graph/list preference per workflow
    if (runId && (tab === 'graph' || tab === 'list')) {
      setWorkflowViewPreference(runId, tab);
    }

    if (tab === activeTab) {
      return;
    }

    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    setSearchParams(params, { replace: false });
  }, [activeTab, dagData?.timeline, runId, searchParams, selectedNodeIds.length, setSearchParams]);

  // Ensure URL always has a valid tab parameter
  useEffect(() => {
    const currentValue = searchParams.get('tab');
    if (!isWorkflowTab(currentValue)) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', activeTab);
      setSearchParams(params, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  const previousTabRef = useRef<TabType | null>(null);
  useEffect(() => {
    if (
      previousTabRef.current !== activeTab &&
      activeTab === 'graph' &&
      selectedNodeIds.length === 0 &&
      dagData?.timeline?.[0]
    ) {
      setSelectedNodeIds([dagData.timeline[0].execution_id]);
    }
    previousTabRef.current = activeTab;
  }, [activeTab, dagData?.timeline, selectedNodeIds.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        switch (event.key) {
          case '1':
            event.preventDefault();
            handleTabChange('graph');
            break;
          case '2':
            event.preventDefault();
            handleTabChange('list');
            break;
          case '3':
            event.preventDefault();
            handleTabChange('io');
            break;
          case '4':
            event.preventDefault();
            handleTabChange('webhooks');
            break;
          case '5':
            event.preventDefault();
            handleTabChange('notes');
            break;
          case '6':
            event.preventDefault();
            handleTabChange('identity');
            break;
          case '7':
            event.preventDefault();
            handleTabChange('insights');
            break;
          case 'f':
            event.preventDefault();
            setFocusMode(!focusMode);
            break;
          case 'r':
            event.preventDefault();
            refreshDAG();
            break;
        }
      }

      if (event.key === "Escape") {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (selectedNodeIds.length > 0) {
          setSelectedNodeIds([]);
        } else {
          navigate("/workflows");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, handleTabChange, isFullscreen, selectedNodeIds, navigate, refreshDAG]);

  const handleNodeSelection = (nodeIds: string[], replace: boolean = true) => {
    if (replace) {
      setSelectedNodeIds(nodeIds);
    } else {
      setSelectedNodeIds(prev => [...new Set([...prev, ...nodeIds])]);
    }
  };

  if (loading) {
    return <EnhancedWorkflowSkeleton />;
  }

  if (error || !displayWorkflow) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h2 className="text-heading-2">
            {error || "Workflow not found"}
          </h2>
          <button
            onClick={() => navigate("/workflows")}
            className="text-body-small text-muted-foreground hover:text-foreground underline"
          >
            ← Back to workflows
          </button>
        </div>
      </div>
    );
  }

  const containerClasses = isFullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col overflow-hidden"
    : "bg-background flex flex-col min-h-0 flex-1 overflow-hidden";

  const contentAreaClasses = "flex flex-1 min-h-0 flex-col overflow-hidden relative z-0";
  const showGraphLoading = dagLoading && !dagData;

  return (
    <ErrorBoundary>
      <div className={containerClasses}>
        {/* Enhanced Header */}
        <EnhancedWorkflowHeader
          workflow={displayWorkflow}
          dagData={dagData}
          isLiveUpdating={!!dagData}
          hasRunningWorkflows={hasRunningWorkflows}
          pollingInterval={currentPollingInterval}
          isRefreshing={dagRefreshing}
          onRefresh={refreshDAG}
          onClose={() => navigate("/workflows")}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
          isFullscreen={isFullscreen}
          onFullscreenChange={setIsFullscreen}
          selectedNodeCount={selectedNodeIds.length}
        />

        {/* Tab Navigation */}
        <EnhancedWorkflowTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          workflow={displayWorkflow}
          dagData={dagData}
          className={isFullscreen ? '' : 'border-b border-border'}
          vcChain={vcChain}
        />

        {/* Dynamic Content Area */}
        <div className={contentAreaClasses}>
          {activeTab === 'graph' && (
            <EnhancedWorkflowFlow
              workflow={displayWorkflow}
              dagData={dagData}
              loading={showGraphLoading}
              isRefreshing={dagRefreshing}
              error={dagError?.message || null}
              selectedNodeIds={selectedNodeIds}
              onNodeSelection={handleNodeSelection}
              viewMode={viewMode}
              focusMode={focusMode}
              isFullscreen={isFullscreen}
              onFocusModeChange={setFocusMode}
            />
          )}

          {activeTab === 'list' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <AgentFilterBar
                nodes={listViewNodes}
                onAgentFilter={handleListAgentFilter}
                selectedAgent={listSelectedAgent}
              />
              <div className="flex-1 min-h-0 overflow-hidden">
                <HierarchicalListView
                  nodes={filteredListViewNodes}
                  onNodeClick={handleListNodeClick}
                  workflowId={runId || ''}
                  viewMode={viewMode}
                />
              </div>
              <NodeDetailSidebar
                node={listSelectedNode ? (listSelectedNode.data as {
                  workflow_id: string;
                  execution_id: string;
                  agent_node_id: string;
                  reasoner_id: string;
                  status: string;
                  started_at: string;
                  completed_at?: string;
                  duration_ms?: number;
                  workflow_depth: number;
                  task_name?: string;
                  agent_name?: string;
                }) : null}
                isOpen={listSidebarOpen}
                onClose={handleListSidebarClose}
              />
            </div>
          )}

          {activeTab === 'io' && (
            <EnhancedWorkflowData
              workflow={displayWorkflow}
              dagData={dagData}
              selectedNodeIds={selectedNodeIds}
              onNodeSelection={handleNodeSelection}
            />
          )}

          {activeTab === 'webhooks' && (
            <EnhancedWorkflowWebhooks
              workflow={displayWorkflow}
              dagData={dagData}
              onNodeSelection={handleNodeSelection}
              onRefresh={refreshDAG}
            />
          )}

          {activeTab === 'notes' && (
            <EnhancedWorkflowEvents
              workflow={displayWorkflow}
              dagData={dagData}
              selectedNodeIds={selectedNodeIds}
              onNodeSelection={handleNodeSelection}
            />
          )}

          {activeTab === 'identity' && (
            <EnhancedWorkflowIdentity
              workflow={displayWorkflow}
              vcChain={vcChain}
            />
          )}

          {activeTab === 'insights' && (
            <div className="h-full overflow-hidden">
              <div className="h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border">
                <EnhancedWorkflowOverview
                  workflow={displayWorkflow}
                  dagData={dagData}
                  vcChain={vcChain}
                  selectedNodeIds={selectedNodeIds}
                  onNodeSelection={handleNodeSelection}
                />
                <div className="px-6 pb-6">
                  <EnhancedWorkflowPerformance
                    workflow={displayWorkflow}
                    dagData={dagData}
                    selectedNodeIds={selectedNodeIds}
                    onNodeSelection={handleNodeSelection}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

function EnhancedWorkflowSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header Skeleton */}
      <div className="h-16 border-b border-border bg-card/50 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* Tabs Skeleton */}
      <div className="h-12 border-b border-border bg-background flex items-center px-6">
        <div className="flex gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="p-6 space-y-8">
        <ResponsiveGrid preset="quarters" gap="md">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </ResponsiveGrid>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
