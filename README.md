## Introduction

This project attempts to create an interactive, collaborative research workspace that allows users explore, map, and interact with scientific literature in a dynamic manner. The platform combines a dynamic, timeline-organized citation graph with automated methodology extraction. Users can visually track the evolution of research topics, customize the graph like a personal whiteboard, and collaborate through community-driven notes and updates.
## Problem Statement

Researchers, graduate students, and engineers are overwhelmed by the sheer volume of static research papers and preprints. Key challenges include: 

- **Information Overload:** Drowning in hundreds of PDFs without clear visibility into research gaps, foundational papers, or how algorithms have evolved over time.
- **Replicability Friction:** Struggling to extract step-by-step experimental methodologies, required materials, and practical bug fixes from dense academic writing.
- **Static Workflows:** Current research tools lack real-time collaboration, whiteboarding capabilities, and community-driven insights to verify if published experiments actually work in practice.
## Objectives
- **Visual Evolution Tracking:** Map research topics and citation networks chronologically to help users instantly identify key clusters, foundational papers, and research gaps.
- **Automated Methodology Extraction:** Mine published papers and preprints to isolate specific experiments, required materials, and results, exporting them into structured formats.
- **Unrestricted Customization:** Provide a personal whiteboard experience where users can edit nodes, sever links, and add sticky notes.
- **Collaborative Workspace:** Enable user-generated posts and visual cues to create a surfable, community-driven feed of insights, bug fixes, and implementation notes.

## Team Members

- Harsh Yadav (2024AIB1006): Leader
- Aditya Kumar Verma (2024AIB1002): Slave
## Technologies Used

- **Frontend:** React.js with Excalidraw for interactive graph visualization for the dynamic whiteboard canvas.
(everything below is planned for the future)
- **Backend:** Python (FastAPI) to handle real-time collaboration, API endpoints, and data processing.
- **Natural Language Processing (NLP) / Extraction:** Python-based NLP pipelines (using LLMs) to mine preprints and papers for methodologies and citations.
