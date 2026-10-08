# Introduction
This project attempts to create an interactive, collaborative research workspace that allows users explore, map, and interact with scientific literature in a dynamic manner. The platform combines a dynamic, timeline-organized citation graph with automated methodology extraction. Users can visually track the evolution of research topics, customize the graph like a personal whiteboard, and collaborate through community-driven notes and updates.

# Team Members
- Harsh Yadav (2024AIB1006)
- Aditya Kumar Verma (2024AIB1002)

# Problem Statement
Researchers, graduate students, and engineers are overwhelmed by the sheer volume of static research papers and preprints. Key challenges include: 
- **Information Overload:** Drowning in hundreds of PDFs without clear visibility into research gaps, foundational papers, or how algorithms have evolved over time.
- **Replicability Friction:** Struggling to extract step-by-step experimental methodologies, required materials, and practical bug fixes from dense academic writing.
- **Static Workflows:** Current research tools lack real-time collaboration, whiteboarding capabilities, and community-driven insights to verify if published experiments actually work in practice.

# Objectives
- **Visual Evolution Tracking:** Map research topics and citation networks chronologically to help users instantly identify key clusters, foundational papers, and research gaps.
- **Automated Methodology Extraction:** Mine published papers and preprints to isolate specific experiments, required materials, and results, exporting them into structured formats.
- **Unrestricted Customization:** Provide a personal whiteboard experience where users can edit nodes, sever links, and add sticky notes.
- **Collaborative Workspace:** Enable user-generated posts and visual cues to create a surfable, community-driven feed of insights, bug fixes, and implementation notes.

# Improvements from LAB:7
- Problem: Adding physical connections between nodes is confusing and non-standard.
**Standardize Edge Creation:** Implement clear anchor points on nodes that appear when hovered over, allowing users to intuitively drag and drop edges to connect nodes.

- Problem: Too many windows popping up and overlapping, sidebars take up excessive space.
**Consolidate UI Panels:** Merge or add collapse toggles to the "Linked Papers" and "Research Node Inspector" sidebars to maximize the visible canvas area and reduce floating window clutter.

- Problem:Graph, edge, and node readability is poor.
**Nodes readability improved:** Providing pop up card not disturbing the whole graph. Edges are clear and visible.

# Documentation 

ExcaliGraph is an interactive, browser-based research tool built with React and TypeScript. It utilizes the Excalidraw engine to map, visualize, and connect academic research papers on an infinite canvas. The core concept is to treat research papers as nodes on a graph and the relationships between them as semantic edges, providing a dynamic way to explore academic lineages.

##State Management

State is managed centrally in `App.tsx` to handle the multi-tab, multi-board nature of the application.

* **`dashboards` Record:** This object stores the state for every whiteboard created. Each `DashboardData` entry contains its own independent lists of `paperNodes`, `paperEdges`, and view transforms (zoom/pan).
* **Tab Switching:** The application uses an `activeTabId` to route the correct dashboard data into the UI and canvas. When a user switches tabs, the canvas receives a completely new set of data and re-renders.
* **The `patchBoard` Pattern:** To prevent race conditions from rapid canvas updates, state updates are performed using a `patchBoard` function that safely merges partial updates with the latest dashboard state using a callback pattern.
* **Edge Creation State Machine:** Connecting papers is an interactive process managed by a custom `useReducer` hook (`edgeFlowReducer`). This state machine orchestrates the 3-step flow (pick source -> pick target -> pick relationship type) and controls the floating `EdgeFlowOverlay` UI.

## Component Map & Responsibilities

The user interface is broken down into modular React components, each serving a specific workflow:

### Core Application
* **`App.tsx`**: The main controller. It owns the file system state, manages multi-tab routing, listens for global keyboard shortcuts (like 'N' for a new node), and processes graph mutations.
* **`main.tsx`**: The React entry point that mounts the `App` component.

### Navigation & Layout
* **`TopNav.tsx`**: The application header. It holds toggles for the left/right sidebars, the editable active board title, and export/import actions (PNG, JSON).
* **`TabBar.tsx`**: Renders the strip of open whiteboard tabs, allowing users to switch contexts or close open files.
* **`Sidebar.tsx` (Left)**: Manages file organization (folders and files). It also includes a "Paper Hub" tab, which provides quick-access buttons to instantly drop preset seminal papers (e.g., LoRA, ResNet) onto the canvas.
* **`GraphSidebar.tsx` (Right)**: Dedicated to graph management. It features a "Linked Papers" tab where users can search for unmapped papers and drag them onto the canvas. It also contains a "Graph" tab listing all existing nodes and edges, providing controls to locate or delete them.

### Interactive Canvas & Overlays
* **`WhiteboardCanvas.tsx`**: The wrapper around the `@excalidraw/excalidraw` package. It translates the internal graph state into visual elements, manages drag sync, and handles Excalidraw-specific events.
* **`HoverCard.tsx`**: A lightweight HTML tooltip that floats over the canvas, providing a quick summary (title, authors, abstract snippet) when hovering over a node.
* **`EdgeFlowOverlay.tsx`**: A floating dialog that guides the user through the process of creating a relational edge between two nodes.
* **`ShortcutsModal.tsx`**: A help dialog displaying keyboard shortcuts for canvas navigation and Excalidraw tools.

### Node Management
* **`AddPaperModal.tsx`**: A form to manually create custom research nodes. It captures metadata like Title, Authors, ArXiv ID, and key insights.
* **`PaperInspector.tsx`**: A detailed slide-out drawer that opens when a canvas node is clicked. It allows users to edit a paper's metadata, change its visual color status, and view/manage all incoming and outgoing relational edges.

## Key Workflows

### 1. Adding Nodes to the Canvas
Users have multiple avenues to populate their boards:
* **Manual Creation:** Pressing `N` opens the `AddPaperModal` to input custom data.
* **Quick-Add:** Clicking a preset in the left `Sidebar` instantly creates a detailed node at the center of the viewport.
* **Drag and Drop:** Users can drag unmapped papers from the `GraphSidebar` directly onto the canvas. This action captures the drop coordinates to position the new node accurately.

### 2. Creating Relational Edges
Edges are semantic connections, not just drawn lines.
* The user initiates the "Add edge" flow from the `GraphSidebar`.
* The `EdgeFlowOverlay` prompts the user to select the source paper on the canvas, then the target paper.
* Finally, the user selects a predefined relationship type (e.g., `extends`, `contradicts`, `cites`). This choice dictates the edge's label and color.

### 3. Inspecting and Editing
* Single-clicking a node on the canvas opens a transient `HoverCard`.
* Double-clicking fully opens the `PaperInspector` drawer.
* Inside the inspector, users can update the reading status (which can change the card's visual badge), edit the abstract, manage tags, and review the paper's specific graph relationships.
