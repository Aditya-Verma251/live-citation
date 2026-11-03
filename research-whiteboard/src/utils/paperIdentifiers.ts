import type { ResearchPaperNode } from '../types';

export interface PaperIdentifierInput {
  canonicalId?: string;
  openAlexId?: string;
  openalex_id?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  arxiv_id?: string;
  identifierType?: string;
  identifier_type?: string;
  identifierValue?: string;
  identifier_value?: string;
  identifiers?: Partial<Record<'doi' | 'arxiv' | 'openalex' | 'pmid', string>>;
}

export function normalizeDoi(value?: string): string | undefined {
  if (!value) return undefined;
  let doi = value.trim();
  doi = doi.replace(/^https?:\/\/(?:dx\.)?(?:www\.)?doi\.org\//i, '');
  doi = doi.replace(/^doi\s*:\s*/i, '');
  try { doi = decodeURIComponent(doi); } catch { /* keep the original value for validation */ }
  doi = doi.split(/[?#]/, 1)[0].replace(/[.,;:!?)\]}]+$/, '').trim();
  return /^10\.\d{4,9}\//i.test(doi) ? doi.toLowerCase() : undefined;
}

export function normalizeOpenAlexId(value?: string): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim().replace(/^openalex\s*:\s*/i, '').replace(/\/$/, '');
  const tail = candidate.split('/').pop() || candidate;
  return /^W\d{5,}$/i.test(tail) ? tail.toUpperCase() : undefined;
}

export function normalizePmid(value?: string): string | undefined {
  if (!value) return undefined;
  let cleaned = value.trim();
  const pubmedUrl = cleaned.match(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
  const ncbiUrl = cleaned.match(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d+)/i);
  if (pubmedUrl || ncbiUrl) cleaned = (pubmedUrl || ncbiUrl)![1];
  const digits = cleaned.replace(/^(?:pmid|pubmed)\s*:\s*/i, '').replace(/\/$/, '');
  return /^\d{6,10}$/.test(digits) ? digits : undefined;
}

export function normalizeArxivId(value?: string): string | undefined {
  if (!value) return undefined;
  let candidate = value.trim();
  candidate = candidate.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, '');
  candidate = candidate.replace(/^arxiv\s*:\s*/i, '').replace(/\.pdf$/i, '').replace(/\/$/, '');
  if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?$/i.test(candidate)) return undefined;
  // arXiv versions are editions of one scholarly work; retain the version in arxivId,
  // but use the versionless base as the stable identity for duplicate detection.
  return candidate.replace(/v\d+$/i, '').toLowerCase();
}

/** Stable scholarly identity, distinct from the whiteboard's per-node UI id. */
export function deriveCanonicalPaperId(paper: PaperIdentifierInput): string | undefined {
  const openAlex = normalizeOpenAlexId(paper.openAlexId || paper.openalex_id || paper.identifiers?.openalex);
  if (openAlex) return openAlex;

  const doi = normalizeDoi(paper.doi || paper.identifiers?.doi);
  if (doi) return `doi:${doi}`;

  const pmid = normalizePmid(paper.pmid || paper.identifiers?.pmid);
  if (pmid) return `pmid:${pmid}`;

  const arxiv = normalizeArxivId(paper.arxivId || paper.arxiv_id || paper.identifiers?.arxiv);
  if (arxiv) return `arxiv:${arxiv}`;

  const existing = paper.canonicalId?.trim();
  return existing || undefined;
}

export function scholarlyIdentifierAliases(paper: PaperIdentifierInput): Set<string> {
  const aliases = new Set<string>();
  const openAlex = normalizeOpenAlexId(paper.openAlexId || paper.openalex_id || paper.identifiers?.openalex);
  const doi = normalizeDoi(paper.doi || paper.identifiers?.doi);
  const pmid = normalizePmid(paper.pmid || paper.identifiers?.pmid);
  const arxiv = normalizeArxivId(paper.arxivId || paper.arxiv_id || paper.identifiers?.arxiv);
  if (openAlex) aliases.add(`openalex:${openAlex}`);
  if (doi) aliases.add(`doi:${doi}`);
  if (pmid) aliases.add(`pmid:${pmid}`);
  if (arxiv) aliases.add(`arxiv:${arxiv}`);

  const canonical = paper.canonicalId?.trim();
  if (canonical) {
    const normalizedOpenAlex = normalizeOpenAlexId(canonical);
    const normalizedDoi = normalizeDoi(canonical);
    if (normalizedOpenAlex) aliases.add(`openalex:${normalizedOpenAlex}`);
    else if (normalizedDoi) aliases.add(`doi:${normalizedDoi}`);
    else if (/^pmid:/i.test(canonical)) aliases.add(`pmid:${canonical.replace(/^pmid:/i, '')}`);
    else if (/^arxiv:/i.test(canonical)) aliases.add(`arxiv:${normalizeArxivId(canonical.replace(/^arxiv:/i, '')) || ''}`);
    else aliases.add(canonical.toLowerCase());
  }
  return aliases;
}

export function isSameScholarlyPaper(
  first: PaperIdentifierInput,
  second: PaperIdentifierInput,
): boolean {
  const firstAliases = scholarlyIdentifierAliases(first);
  if (!firstAliases.size) return false;
  const secondAliases = scholarlyIdentifierAliases(second);
  return [...firstAliases].some((alias) => secondAliases.has(alias));
}

export function withCanonicalPaperId<T extends ResearchPaperNode>(paper: T): T {
  const canonicalId = deriveCanonicalPaperId(paper);
  return canonicalId ? { ...paper, canonicalId } : paper;
}
