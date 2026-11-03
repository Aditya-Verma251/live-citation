import type { RelationType, ResearchPaperEdge, ResearchPaperNode } from '../types';
import { deriveCanonicalPaperId } from '../utils/paperIdentifiers';

const COLORS = ['#4f46e5', '#0284c7', '#0891b2', '#7c3aed', '#0f766e', '#c2410c', '#be185d'];

type AnyRecord = Record<string, any>;

function object(value: any): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unwrap(value: any): any {
  const record = object(value);
  return record.data ?? record.result ?? record;
}

function listFrom(payload: any, keys: string[]): AnyRecord[] {
  const root = unwrap(payload);
  if (Array.isArray(root)) return root.filter((item) => item && typeof item === 'object');
  for (const key of keys) {
    const candidate = root?.[key] ?? root?.data?.[key] ?? root?.result?.[key];
    if (Array.isArray(candidate)) return candidate.filter((item) => item && typeof item === 'object');
  }
  return [];
}

function firstValue(record: AnyRecord, keys: string[]): any {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asText(value: any, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((part) => asText(part)).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return asText(value.name ?? value.full_name ?? value.id, fallback);
  return fallback;
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value.trim()
      ? value.split(/[,;]/).map((part) => part.trim()).filter(Boolean)
      : [];
  }
  return value.map((item) => asText(item)).filter(Boolean);
}

function profileFieldValue(profile: AnyRecord, name: string): any {
  const fields = object(profile.fields);
  const item = object(fields[name]);
  if (item.value !== undefined && item.value !== null && item.value !== '') return item.value;
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  return evidence.map((entry: any) => asText(entry?.quote)).filter(Boolean);
}

function normalizeAlias(value: any): string {
  let raw = asText(value).trim();
  if (!raw) return '';
  raw = raw.replace(/^paper:/i, '').trim();

  // DOI resolver URLs, prefixes and bare values share a lowercase alias.
  const doiUrl = raw.match(/^https?:\/\/(?:dx\.)?(?:www\.)?doi\.org\/(.+)$/i);
  if (doiUrl) {
    try { raw = decodeURIComponent(doiUrl[1]); } catch { raw = doiUrl[1]; }
  }
  raw = raw.replace(/^doi:/i, '').replace(/[.,;:!?)\]}]+$/, '');
  if (/^10\.\d{4,9}\//i.test(raw)) return raw.toLowerCase();

  // OpenAlex accepts short IDs, openalex:W..., and canonical/API work URLs.
  raw = raw.replace(/^openalex:/i, '');
  const openAlexUrl = raw.match(/^https?:\/\/(?:api\.|www\.)?openalex\.org\/(?:works\/)?(W\d+)\/?$/i);
  if (openAlexUrl) raw = openAlexUrl[1].toUpperCase();
  if (/^W\d{5,}$/i.test(raw)) return raw.toUpperCase();

  // arXiv IDs can appear as bare IDs, arXiv: IDs, or abs/pdf URLs.
  const arxivUrl = raw.match(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/([^?#]+)$/i);
  if (arxivUrl) {
    try { raw = decodeURIComponent(arxivUrl[1]).replace(/\.pdf$/i, ''); }
    catch { raw = arxivUrl[1].replace(/\.pdf$/i, ''); }
  }
  raw = raw.replace(/^arxiv:/i, '');
  if (/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?$/i.test(raw)) return raw.toLowerCase();

  // PubMed and NCBI URLs plus PMID:/PubMed: values resolve to one numeric alias.
  const pubmedUrl = raw.match(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/i);
  const ncbiUrl = raw.match(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d+)\/?$/i);
  if (pubmedUrl || ncbiUrl) raw = (pubmedUrl || ncbiUrl)![1];
  raw = raw.replace(/^(?:pmid|pubmed):/i, '');
  if (/^\d{6,10}$/.test(raw)) return raw;

  return raw.trim();
}

function endpointId(value: any): string {
  const raw = value && typeof value === 'object'
    ? asText(firstValue(value, ['paper_id', 'id', 'node_id', 'canonical_id', 'canonicalId', 'openalex_id', 'arxiv_id', 'doi', 'pmid', 'identifier_value', 'identifierValue', 'title', 'name', 'label']))
    : asText(value);
  return normalizeAlias(raw);
}

function paperRecord(row: AnyRecord): AnyRecord {
  return object(row.paper ?? row.attributes?.paper ?? row.attributes ?? row.data ?? row);
}

function rowAliases(row: AnyRecord): string[] {
  const paper = paperRecord(row);
  const paperIdentifiers = object(paper.identifiers);
  const rowIdentifiers = object(row.identifiers);
  const keys = ['paper_id', 'id', 'node_id', 'canonical_id', 'canonicalId', 'openalex_id', 'arxiv_id', 'doi', 'pmid', 'identifier_value', 'identifierValue', 'title', 'paper_title', 'name', 'label'];
  const values = [
    ...keys.map((key) => firstValue(paper, [key])),
    ...keys.map((key) => firstValue(row, [key])),
    ...['openalex', 'doi', 'arxiv', 'pmid'].map((key) => paperIdentifiers[key]),
    ...['openalex', 'doi', 'arxiv', 'pmid'].map((key) => rowIdentifiers[key]),
  ];
  return Array.from(new Set(values.map(normalizeAlias).filter(Boolean)));
}

function inferRelation(value: any): RelationType {
  const text = asText(value, 'related').toLowerCase().replace(/[_-]+/g, ' ');
  if (/cite|referenc/.test(text)) return 'cites';
  if (/extend|build|follow.?up/.test(text)) return 'extends';
  if (/improv|enhanc|optim/.test(text)) return 'improves';
  if (/contradict|conflict|challenge|refut|disagree/.test(text)) return 'contradicts';
  if (/benchmark|evaluat/.test(text)) return 'benchmarks';
  if (/foundation|theor/.test(text)) return 'theoretical-foundation';
  return 'custom';
}

function readableRelationLabel(backendType: string, suppliedLabel: any): string {
  const supplied = asText(suppliedLabel).trim();
  if (supplied) return supplied;
  if (!backendType) return 'Related';
  return backendType.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addAlias(map: Map<string, string>, alias: string, nodeId: string) {
  const normalized = normalizeAlias(alias);
  if (!normalized) return;
  map.set(normalized, nodeId);
  // Titles and text aliases are matched case-insensitively as a fallback.
  map.set(normalized.toLowerCase(), nodeId);
}

/**
 * Converts the backend's /papers, /graph and /relationships payloads into the whiteboard model.
 * The unified backend graph is authoritative: its `kind` field distinguishes bibliographic
 * edges from content-inferred research relationships. /relationships.inferred_edges is used
 * as a fallback for deployments that return an older graph.json without inferred edges.
 */
export function mapResearchGraph(
  papersPayload: any,
  graphPayload: any,
  relationshipsPayload: any,
): {
  nodes: ResearchPaperNode[];
  edges: ResearchPaperEdge[];
  citationEdges: ResearchPaperEdge[];
  identifiedRelationshipEdges: ResearchPaperEdge[];
} {
  const paperRows = listFrom(papersPayload, ['papers', 'items', 'results', 'discovered_papers']);
  const graphEnvelope = object(unwrap(graphPayload));
  const graphRoot = object(graphEnvelope.graph ?? graphEnvelope);

  const rawGraphRows = listFrom(graphRoot, ['nodes', 'papers', 'vertices']);
  // Gap nodes are intentionally not converted into paper nodes. They remain available via /gaps.
  const graphPaperRows = rawGraphRows.filter((row) => {
    const kind = String(row.type ?? row.node_type ?? '').toLowerCase();
    const id = String(row.id ?? '');
    return kind !== 'research_gap' && kind !== 'gap' && !id.startsWith('gap:');
  });

  const graphEdges = listFrom(graphRoot, ['edges', 'links', 'relationships']);
  const relationshipsRoot = unwrap(relationshipsPayload);
  const relationshipEdges = [
    ...listFrom(relationshipsRoot, ['inferred_edges']),
    ...listFrom(relationshipsRoot, ['relationships', 'relations', 'edges', 'items', 'results']),
  ];

  // /papers is the preferred source for paper metadata; graph nodes fill in missing papers.
  const allRows = [...paperRows];
  const knownAliases = new Set(allRows.flatMap(rowAliases));
  for (const row of graphPaperRows) {
    const aliases = rowAliases(row);
    if (!aliases.some((alias) => knownAliases.has(alias))) allRows.push(row);
    aliases.forEach((alias) => knownAliases.add(alias));
  }

  const idMap = new Map<string, string>();
  const nodes: ResearchPaperNode[] = allRows.map((raw, index) => {
    const paper = paperRecord(raw);
    const rawId = normalizeAlias(firstValue(paper, ['paper_id', 'id', 'node_id', 'canonical_id', 'canonicalId', 'openalex_id', 'arxiv_id', 'doi', 'pmid', 'identifier_value', 'identifierValue']))
      || normalizeAlias(firstValue(raw, ['paper_id', 'id', 'node_id', 'canonical_id', 'canonicalId', 'openalex_id', 'arxiv_id', 'doi', 'pmid', 'identifier_value', 'identifierValue']))
      || `result-${index + 1}`;
    const id = `research-paper-${rawId}`;
    const title = asText(firstValue(paper, ['title', 'paper_title', 'name', 'label']), `Untitled paper ${index + 1}`);
    const authors = asText(firstValue(paper, ['authors', 'author', 'author_names']), 'Unknown authors');
    const yearValue = firstValue(paper, ['year', 'publication_year', 'published_year']);
    const parsedYear = Number.parseInt(String(yearValue ?? ''), 10);
    const tags = asStringArray(firstValue(paper, ['tags', 'keywords', 'topics', 'fields_of_study']));
    const x = Number.isFinite(Number(raw.x ?? paper.x)) ? Number(raw.x ?? paper.x) : 180 + (index % 3) * 340;
    const y = Number.isFinite(Number(raw.y ?? paper.y)) ? Number(raw.y ?? paper.y) : 120 + Math.floor(index / 3) * 260;
    const citationCount = firstValue(paper, ['cited_by_count', 'citations', 'citation_count', 'citations_count']);
    const parsedCitationCount = citationCount === undefined ? undefined : Number(citationCount);
    const arxivId = asText(firstValue(paper, ['arxiv_id', 'arxivId'])) || undefined;
    const doi = asText(firstValue(paper, ['doi'])) || asText(object(paper.identifiers).doi) || undefined;
    const pmid = asText(firstValue(paper, ['pmid'])) || asText(object(paper.identifiers).pmid) || undefined;
    const openAlexId = asText(firstValue(paper, ['openalex_id', 'openAlexId'])) || asText(object(paper.identifiers).openalex) || undefined;
    const canonicalId = asText(firstValue(paper, ['canonical_id', 'canonicalId']))
      || deriveCanonicalPaperId({ arxivId, doi, pmid, openAlexId, identifiers: object(paper.identifiers) as any })
      || (/^W\d{5,}$/i.test(rawId) ? rawId.toUpperCase() : undefined);
    const analysisStatus = asText(firstValue(paper, ['analysis_status', 'status'])).toLowerCase();
    const analysis = object(paper.analysis ?? raw.analysis ?? raw.analysis_artifact?.analysis);
    const researchProfile = object(
      paper.research_profile ?? paper.researchProfile ??
      analysis.research_profile ?? analysis.researchProfile ??
      raw.research_profile ?? raw.researchProfile
    );
    const profileCompleteness = object(
      paper.research_profile_completeness ?? paper.researchProfileCompleteness ??
      analysis.research_profile_completeness ?? researchProfile.completeness
    );
    const profileValue = (field: string) => profileFieldValue(researchProfile, field);
    const analysisValue = (field: string) => {
      const direct = analysis[field];
      const hasDirect = direct !== undefined && direct !== null && direct !== '' &&
        !(Array.isArray(direct) && direct.length === 0) &&
        !(typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length === 0);
      return hasDirect ? direct : profileValue(field);
    };
    const keyInsights = asStringArray(firstValue(paper, ['key_insights', 'keyInsights', 'contributions', 'insights']))
      .concat(asStringArray(analysisValue('key_findings'))).filter((value, position, values) => values.indexOf(value) === position);

    // Resolve all common IDs returned by /papers and /graph, including OpenAlex URLs and DOI.
    rowAliases(raw).forEach((alias) => addAlias(idMap, alias, id));
    [rawId, title].forEach((alias) => addAlias(idMap, alias, id));

    return {
      id,
      title,
      authors,
      abstract: asText(firstValue(paper, ['abstract', 'summary', 'description']), ''),
      year: Number.isFinite(parsedYear) ? parsedYear : 'Unknown',
      venue: asText(firstValue(paper, ['venue', 'journal', 'conference', 'publication']), 'Research paper'),
      arxivId,
      canonicalId,
      doi,
      pmid,
      openAlexId,
      identifiers: Object.keys(object(paper.identifiers)).length ? object(paper.identifiers) as any : undefined,
      identifierType: asText(firstValue(paper, ['identifier_type', 'identifierType'])) || undefined,
      identifierValue: asText(firstValue(paper, ['identifier_value', 'identifierValue'])) || undefined,
      url: asText(firstValue(paper, ['url', 'paper_url', 'pdf_url', 'landing_page_url', 'link'])) || undefined,
      keyInsights,
      tags,
      conclusion: asText(analysisValue('conclusion')) || undefined,
      keyFindings: asStringArray(analysisValue('key_findings')).length ? asStringArray(analysisValue('key_findings')) : undefined,
      researchProblem: asText(analysisValue('research_problem')) || undefined,
      researchObjective: asText(analysisValue('research_objective')) || undefined,
      researchQuestions: asStringArray(analysisValue('research_questions')).length ? asStringArray(analysisValue('research_questions')) : undefined,
      researchGaps: asStringArray(analysisValue('research_gaps')).length ? asStringArray(analysisValue('research_gaps')) : undefined,
      limitations: asStringArray(analysisValue('limitations')).length ? asStringArray(analysisValue('limitations')) : undefined,
      futureWork: asStringArray(analysisValue('future_work')).length ? asStringArray(analysisValue('future_work')) : undefined,
      methodology: asText(analysisValue('methodology')) || undefined,
      methodConcepts: asStringArray(analysisValue('method_concepts')).length ? asStringArray(analysisValue('method_concepts')) : undefined,
      datasets: asStringArray(analysisValue('datasets')).length ? asStringArray(analysisValue('datasets')) : undefined,
      evaluationMetrics: asStringArray(analysisValue('evaluation_metrics')).length ? asStringArray(analysisValue('evaluation_metrics')) : undefined,
      contributions: asStringArray(analysisValue('contributions')).length ? asStringArray(analysisValue('contributions')) : undefined,
      researchProfile: Object.keys(researchProfile).length ? researchProfile as any : undefined,
      researchProfileCompleteness: Object.keys(profileCompleteness).length ? profileCompleteness as any : undefined,
      citationsCount: parsedCitationCount !== undefined && Number.isFinite(parsedCitationCount) ? parsedCitationCount : undefined,
      status: analysisStatus === 'analyzed' ? 'read' : 'to-read',
      color: COLORS[index % COLORS.length],
      x,
      y,
      width: 320,
      height: 195,
    };
  });

  // Graph node IDs may differ from /papers IDs. Match by scholarly identifiers first.
  // Fall back to title only when it is unique; never bind same-title works to the first node.
  graphPaperRows.forEach((row) => {
    const aliases = rowAliases(row);
    const graphTitle = asText(firstValue(paperRecord(row), ['title', 'paper_title', 'name', 'label']));
    const matchedByAlias = aliases
      .map((alias) => idMap.get(alias) ?? idMap.get(alias.toLowerCase()))
      .find((nodeId): nodeId is string => Boolean(nodeId));
    if (matchedByAlias) {
      aliases.forEach((alias) => addAlias(idMap, alias, matchedByAlias));
      return;
    }
    const matchingNodes = nodes.filter((node) => node.title.trim().toLowerCase() === graphTitle.trim().toLowerCase());
    if (matchingNodes.length === 1) {
      aliases.forEach((alias) => addAlias(idMap, alias, matchingNodes[0].id));
    }
  });

  // Graph JSON normally contains all edges. Relationship JSON is appended as a compatibility
  // fallback; de-duplication below prevents showing the same inferred edge twice.
  const edgeCandidates = [
    ...graphEdges.map((row) => object(row)),
    ...relationshipEdges.map((row) => object(row)),
  ];
  const edges: ResearchPaperEdge[] = [];
  const edgeKeys = new Set<string>();

  edgeCandidates.forEach((row, index) => {
    const sourceRef = firstValue(row, ['source_paper_id', 'source_id', 'source_node_id', 'from_paper_id', 'source_paper', 'source', 'from', 'source_node', 'paper_a', 'paper1']);
    const targetRef = firstValue(row, ['target_paper_id', 'target_id', 'target_node_id', 'to_paper_id', 'target_paper', 'target', 'to', 'target_node', 'paper_b', 'paper2']);
    const sourceAlias = endpointId(sourceRef);
    const targetAlias = endpointId(targetRef);
    const sourceNodeId = idMap.get(sourceAlias) ?? idMap.get(sourceAlias.toLowerCase());
    const targetNodeId = idMap.get(targetAlias) ?? idMap.get(targetAlias.toLowerCase());
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;

    const backendType = asText(firstValue(row, ['type', 'relation_type', 'relationship_type', 'edge_type'])).toLowerCase();
    const backendKind = asText(firstValue(row, ['kind', 'edge_kind'])).toLowerCase();
    const isBibliographic = backendKind === 'bibliographic'
      || backendKind === 'discovery_similarity'
      || backendType === 'cites'
      || backendType === 'related_to';
    // Every remaining paper-to-paper edge in this backend schema is a content-inferred
    // relationship; explicit gap links are excluded separately below.
    const graphKind: ResearchPaperEdge['graphKind'] = isBibliographic ? 'citation' : 'identified';

    // `identifies_gap` points to a gap node, not another paper, and is excluded above when its
    // target cannot resolve to a paper. This guard also prevents accidental paper-to-paper display.
    if (backendType === 'identifies_gap') return;

    const relationType = inferRelation(backendType || firstValue(row, ['label', 'relation']));
    const label = readableRelationLabel(backendType, firstValue(row, ['label', 'relation', 'relationship_type']));
    const key = `${sourceNodeId}->${targetNodeId}:${graphKind}:${backendType || relationType}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);

    const scoreValue = firstValue(row, ['score', 'similarity_score']);
    const score = scoreValue === undefined ? undefined : Number(scoreValue);

    edges.push({
      id: asText(row.id) || `research-edge-${index}-${sourceNodeId}-${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      relationType,
      label,
      description: asText(firstValue(row, ['explanation', 'description', 'reason'])) || undefined,
      graphKind,
      backendRelationType: backendType || undefined,
      backendEdgeKind: backendKind || (graphKind === 'identified' ? 'inferred_research' : undefined),
      score: score !== undefined && Number.isFinite(score) ? score : undefined,
      confidenceLabel: asText(row.confidence_label) || undefined,
      requiresHumanReview: typeof row.requires_human_review === 'boolean' ? row.requires_human_review : undefined,
      sharedTerms: asStringArray(row.shared_terms),
      evidence: row.evidence,
    });
  });

  const citationEdges = edges.filter((edge) => edge.graphKind === 'citation');
  const identifiedRelationshipEdges = edges.filter((edge) => edge.graphKind === 'identified');

  return { nodes, edges, citationEdges, identifiedRelationshipEdges };
}
