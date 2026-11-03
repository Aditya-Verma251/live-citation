from relationships.analyzer import analyze_paper_against_board


def test_new_paper_is_compared_against_every_existing_paper():
    existing = [
        {
            "id": "old-1",
            "title": "Graph neural networks for scholarly citation recommendation",
            "abstract": "A graph neural network approach for recommending academic references.",
            "keyInsights": ["Graph neural network improves precision and recall for scholarly citation recommendation."],
            "researchGaps": ["Future work should evaluate multilingual scholarly citation datasets."],
            "methodology": "Train graph neural network representations on citation graph nodes.",
        },
        {
            "id": "old-2",
            "title": "A survey of medical image segmentation",
            "abstract": "A review of medical image segmentation techniques.",
            "keyInsights": ["The survey compares segmentation architectures for radiology images."],
        },
        {
            "id": "old-3",
            "title": "Neural recommendation systems",
            "abstract": "Recommendation models based on neural networks.",
            "keyInsights": ["Neural ranking improves recommendation precision in user-item systems."],
        },
    ]
    new_paper = {
        "id": "new-1",
        "title": "Multilingual graph learning for scientific citation recommendation",
        "abstract": "We recommend scholarly citations using graph neural learning.",
        "keyInsights": ["Graph representation learning improves precision and recall for scientific citation recommendation."],
        "methodology": "We train graph neural representations using scholarly citation networks.",
    }

    result = analyze_paper_against_board(new_paper, existing)

    assert result["checked_count"] == 3
    assert result["candidate_count"] >= 1
    assert result["connection_count"] >= 1
    assert len(result["comparisons"]) == 3
    assert all(edge["requires_human_review"] for edge in result["edges"])


def test_gap_direction_is_from_existing_gap_owner_to_new_paper():
    existing = [{
        "id": "gap-owner",
        "title": "Limitations of citation recommendation",
        "abstract": "Scholarly citation recommendation systems.",
        "conclusion": "The current approach evaluates only English citation records.",
        "researchGaps": ["Future work should evaluate graph neural recommendation on multilingual scholarly citation datasets and low-resource languages."],
    }]
    new_paper = {
        "id": "new-multilingual",
        "title": "Multilingual graph neural citation recommendation",
        "abstract": "A multilingual system for scholarly citation recommendation.",
        "conclusion": "Our graph neural model is evaluated on multilingual scholarly citation datasets and low-resource languages.",
        "methodology": "We train graph neural recommendation models on multilingual scholarly citation networks.",
    }

    result = analyze_paper_against_board(new_paper, existing)
    gap_edges = [edge for edge in result["edges"] if edge["type"] == "potentially_addresses_gap"]

    assert gap_edges
    assert gap_edges[0]["source"] == "gap-owner"
    assert gap_edges[0]["target"] == "new-multilingual"


def test_duplicate_relationship_is_not_returned_twice():
    old = {
        "id": "old",
        "title": "Graph neural citation recommendation",
        "abstract": "Graph neural recommendation for scientific citations.",
        "conclusion": "Graph neural networks improve precision and recall for scientific citation recommendation.",
    }
    new = {
        "id": "new",
        "title": "Scientific citation recommendation with graph neural networks",
        "abstract": "Graph neural models for recommending scientific citations.",
        "conclusion": "Graph neural models improve precision and recall in scholarly citation recommendation.",
    }

    first = analyze_paper_against_board(new, [old])
    assert first["connection_count"] >= 1
    already_present = [{
        "sourceNodeId": edge["source"],
        "targetNodeId": edge["target"],
        "backendRelationType": edge["type"],
    } for edge in first["edges"]]
    second = analyze_paper_against_board(new, [old], already_present)
    assert second["candidate_count"] >= 1
    assert second["connection_count"] == 0
