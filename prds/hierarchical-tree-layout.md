# PRD: Hierarchical Tree Layout for Workflow Executions

## Introduction

Add a collapsible, file-explorer-style tree layout as a selectable view option within the graph tab of the workflow detail page. This replaces the existing broken `HierarchicalListView` component and separate "list" tab with a clean, minimal tree view that lives alongside the other layout options (tree, flow, ELK layouts) in the graph tab's layout controls.

## Goals

- Provide a lightweight, text-based alternative to the visual graph layouts for navigating workflow execution hierarchies
- Enable users to drill into deeply nested sub-workflows without visual clutter
- Support large workflows (1000+ nodes) via lazy-loading children on expand
- Clicking a node in the tree opens the existing `NodeDetailSidebar` for full details

## User Stories

### 1. Switch to Tree List Layout
**Description:** As a user viewing a workflow in the graph tab, I want to select "List" from the layout controls so that I see a collapsible tree instead of a node-link diagram.

**Acceptance Criteria:**
- [ ] A "List" option appears in the `LayoutControls` bar alongside existing layouts (Tree View, Flow View, etc.)
- [ ] Selecting "List" replaces the React Flow / DeckGL canvas with a collapsible tree view
- [ ] Switching back to any graph layout restores the React Flow canvas
- [ ] The selected layout persists within the session (same as other layouts)
- [ ] Typecheck passes (`npm run lint` in `control-plane/web/client`)

### 2. Expand and Collapse Nodes
**Description:** As a user viewing the tree list, I want to click a chevron to expand or collapse a node so that I can drill into or hide child executions.

**Acceptance Criteria:**
- [ ] Each node with children shows a right-pointing chevron (`▶`) when collapsed
- [ ] Clicking the chevron expands the node, showing its children indented one level, and the chevron rotates to point down (`▼`)
- [ ] Clicking the chevron again collapses the node, hiding children
- [ ] Root nodes are expanded by default (depth 0)
- [ ] Nodes at depth 1+ are collapsed by default
- [ ] Expand/collapse is instant with no animation delay
- [ ] Leaf nodes (no children) show no chevron — just indentation

### 3. Select a Node to View Details
**Description:** As a user, I want to click a node row (not the chevron) to select it and open the detail sidebar so that I can inspect execution details.

**Acceptance Criteria:**
- [ ] Clicking anywhere on a node row (except the chevron) calls `onNodeClick` with that node
- [ ] The clicked row gets a visible selected/highlighted style (e.g., subtle background color)
- [ ] Only one node can be selected at a time
- [ ] The existing `NodeDetailSidebar` opens with the selected node's data
- [ ] Verify in browser: sidebar opens and shows correct node info

### 4. Lazy-Load Children for Large Workflows
**Description:** As a user viewing a workflow with 1000+ executions, I want children to load on demand when I expand a node so that the initial render is fast.

**Acceptance Criteria:**
- [ ] On initial load, only root-level nodes and their immediate metadata are rendered
- [ ] Expanding a node fetches its children from the already-loaded DAG data (no extra API call needed if data is in memory)
- [ ] For workflows where the full DAG is already fetched (via `useWorkflowDAGSmart`), children are resolved from the in-memory tree — no additional network request
- [ ] If the DAG data uses lightweight mode (`WorkflowDAGLightweightNode`), expanding still works by filtering the flat node list by `parent_execution_id`
- [ ] A loading indicator appears briefly if children take time to resolve
- [ ] The tree does not render all 1000+ rows upfront — only visible/expanded rows exist in the DOM

### 5. Node Row Displays Key Metadata Inline
**Description:** As a user, I want each row to show the execution's status, agent name, and task name so that I can scan the tree without opening the sidebar.

**Acceptance Criteria:**
- [ ] Each row displays: `[chevron] [status icon] [agent_name] → [task_name/reasoner_id]`
- [ ] Status icon uses the same color coding as the graph view (green=succeeded, red=failed, blue=running, gray=pending)
- [ ] Agent name uses the same color from `agentColorManager` as the graph view for consistency
- [ ] Rows are compact — single line height, no cards or extra padding
- [ ] Verify in browser: rows are visually scannable and aligned

## Functional Requirements

1. **Add `'list'` to `AllLayoutType`** — Extend the layout type union in `LayoutManager.ts` to include `'list'` as a valid layout option.
2. **Add "List" button to `LayoutControls`** — The layout controls bar shows a "List" button. Selecting it sets `currentLayout` to `'list'`.
3. **Conditional rendering in `WorkflowDAGViewer`** — When `currentLayout === 'list'`, render the new `TreeListLayout` component instead of ReactFlow/DeckGL. Pass the same `nodes`, `onNodeClick`, and workflow data props.
4. **New `TreeListLayout` component** — A standalone component in `WorkflowDAG/TreeListLayout.tsx` that:
   - Accepts the DAG node tree (or flat node list) and renders a collapsible tree
   - Manages expand/collapse state internally
   - Calls `onNodeClick(node)` when a row is clicked
   - Tracks selected node ID for highlight styling
5. **Build tree from flat nodes** — If receiving a flat `Node[]` array, build the parent-child tree using `parent_execution_id` from node data (same logic as existing `transformRunDetailToDag`).
6. **Remove the separate "list" tab** — Remove the `'list'` entry from `TabType` and `WORKFLOW_TAB_VALUES` in `EnhancedWorkflowDetailPage.tsx`. Remove the old `HierarchicalListView` usage from that page. The old `HierarchicalListView.tsx` file can be deleted.
7. **Row rendering** — Each row is a `<div>` with:
   - Left padding = `depth * 20px` (indentation)
   - Chevron button (16px) or empty spacer for leaf nodes
   - Status dot/icon (12px circle, color from `getStatusTheme`)
   - Agent name (colored text via `agentColorManager`)
   - Arrow separator (`→`)
   - Task/reasoner name (muted text)
8. **Keyboard navigation (stretch)** — Arrow keys to move selection, Enter to expand/collapse, but this is not required for initial implementation.

## Non-Goals

- **No virtual scrolling in v1** — Lazy-loading children on expand keeps the DOM manageable. Virtual scrolling can be added later if needed.
- **No drag-and-drop** — This is a read-only view.
- **No inline editing** — Notes, re-runs, etc. happen in the sidebar.
- **No search/filter within the tree** — The existing agent filter bar above the graph tab can be reused later.
- **No animation on expand/collapse** — Keep it snappy.

## Design Considerations

- The tree should feel like a VS Code file explorer or a terminal `tree` output — minimal chrome, dense information.
- Use monospace or the existing UI font at a slightly smaller size for compactness.
- Selected row should have a subtle highlight (e.g., `bg-accent/50`) — not a heavy border or card.
- The tree should fill the same container as the React Flow canvas, using the full available height with overflow-y scroll.
- Status colors and agent colors must match the graph view exactly for visual consistency.

## Technical Considerations

- **Layout type extension**: Adding `'list'` to `AllLayoutType` means `LayoutManager` methods that operate on graph layouts (dagre, ELK) need to handle or skip `'list'` — the list layout does not use `LayoutManager.applyLayout()`.
- **Props interface**: `TreeListLayout` should accept the same `nodes: Node[]` that `WorkflowDAGViewer` already has, plus `onNodeClick`. It builds its own tree internally.
- **State isolation**: Expand/collapse state is local to `TreeListLayout`. Switching away and back resets it (acceptable for v1).
- **Reuse `NodeDetailSidebar`**: The sidebar is already rendered by `WorkflowDAGViewer` — the tree layout just needs to call the same `onNodeClick` callback.
- **Delete old code**: Remove `HierarchicalListView.tsx` and all imports/references to it. Remove the "list" tab from `EnhancedWorkflowDetailPage.tsx`.

## Success Metrics

- Users can switch to the list layout and navigate a workflow hierarchy using expand/collapse
- Initial render of a 1000-node workflow in list layout takes under 200ms (only root nodes rendered)
- The detail sidebar opens correctly when clicking any node in the tree
- No TypeScript or lint errors introduced

## Open Questions

1. Should the agent filter bar (`AgentFilterBar`) be shown above the tree list layout, or deferred to a later iteration?
2. Should expand/collapse state persist when switching between layouts, or is reset acceptable?
