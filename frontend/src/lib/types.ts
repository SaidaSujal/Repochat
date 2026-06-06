export interface RepositoryIngestRequest {
  github_url: string;
}

export interface RepositoryResponse {
  id: number;
  github_url: string;
  owner: string;
  name: string;
  star_count: number;
  fork_count: number;
  language: string | null;
  file_count: number;
  total_size_bytes: number;
  summary: string | null;
  architecture_overview: string | null;
  commit_sha?: string | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error_message?: string | null;
  created_at: string;
  expires_at: string;
}

export interface ChatRequest {
  query: string;
}

export interface CodeSnippet {
  file_path: string;
  lines: string;
  code_content: string;
}

export interface Citation {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface ChatResponse {
  short_answer: string;
  detailed_explanation: string;
  code_snippets: CodeSnippet[];
  citations: Citation[];
  follow_up_suggestions: string[];
}

export interface ApiError {
  detail?: string | Array<{ msg: string; loc: string[]; type: string }>;
  error?: string;
}
